import {
  indexTree,
  createDocumentSerializer,
  createDocumentCodec,
  type NodeIdentity,
  type Schema,
} from '../model';
import { supportsOwnedText } from '../owned-text-support';
import {
  RangeSelection,
  NodeSelection,
  applyTransaction,
  selectionContext,
  textSelection,
  type EditorState,
} from '../state';
import { type Step } from '../transform';
import { replaceStructuredText } from './blocks';
import type { StarterNode } from './demo-model';
import { demoDocumentCodec } from './demo-schema';
import { importHtml } from './html';
import { paragraph, table } from './starter-definitions';
import { starterSerializers } from './static-serializers';
import { copyCellRectangle, cellRectangleText, pasteCellRectangle } from './table-clipboard';

export type ClipboardFragment<N = StarterNode> = { nodes: readonly N[]; inline: boolean };

const mime = 'application/x-gprose-fragment';

// The token refers only to immutable fragments created in this page. Untrusted
// clipboard JSON never becomes editor state; other pages use the inert HTML importer.
const fragments = new Map<
  string,
  {
    read<N extends NodeIdentity>(schema: Schema<N>): ClipboardFragment<N>;
  }
>();

function remember<N extends NodeIdentity>(schema: Schema<N>, fragment: ClipboardFragment<N>) {
  const token = crypto.randomUUID();
  fragments.set(token, {
    read<T extends NodeIdentity>(target: Schema<T>): ClipboardFragment<T> {
      if (Object.is(target, schema)) {
        const canonical: ClipboardFragment<NodeIdentity> = fragment;

        // SAFETY: Schema object identity proves that these canonical nodes belong to
        // the target schema. No externally supplied value enters this local store.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Restore the node type after checking the exact schema owner; retaining immutable node identity avoids a serialization boundary.
        return canonical as ClipboardFragment<T>;
      }

      return {
        inline: fragment.inline,
        nodes: createDocumentCodec(target).decode(
          createDocumentCodec(schema).encode(fragment.nodes),
        ),
      };
    },
  });

  if (fragments.size > 8) {
    const first = fragments.keys().next().value;

    if (first) fragments.delete(first);
  }

  return token;
}

export function writeClipboard<N extends NodeIdentity>(
  data: DataTransfer,
  schema: Schema<N>,
  state: EditorState<N>,
  text: string,
  serializer = createDocumentSerializer(schema, starterSerializers, { unsupported: 'text' }),
) {
  const ranges = state.selection.ranges(selectionContext(schema, state.nodes)),
    byId = new Map(ranges.map((r) => [r.id, r]));

  function slice(node: N): N[] {
    const range = byId.get(node.id);

    if (range?.kind === 'node') return [node];

    if (range?.kind === 'text') {
      if (range.from === range.to)
        return schema.text(node) === '' && ranges.length > 1 ? [node] : [];

      // A whole text block is already an immutable fragment; only endpoints need slicing.
      if (range.from === 0 && range.to === schema.text(node)?.length) return [node];

      const editing = schema.editing(node),
        left = editing.split(node, range.to, node)[0];

      return [range.from ? editing.split(left, range.from, node)[1] : left];
    }

    const children = schema.children(node);

    if (!children.length) return [];
    const selected = children.flatMap(slice);

    return selected.length ? [schema.withChildren(node, selected)] : [];
  }

  const rectangle = copyCellRectangle(schema, state);

  const nodes = rectangle ? [rectangle] : state.nodes.flatMap(slice),
    context = selectionContext(schema, state.nodes);

  const inline =
    nodes.length === 1 &&
    schema.text(nodes[0]) !== null &&
    ranges.some(
      (r) => r.kind === 'text' && (r.from > 0 || r.to < (context.text(r.id)?.length ?? 0)),
    );

  const token = remember(schema, { nodes, inline });

  data.setData('text/plain', rectangle ? cellRectangleText(schema, rectangle) : text);
  data.setData('text/html', serializer.serialize(nodes).html);
  data.setData(mime, token);
}

export function readClipboard<N extends NodeIdentity>(
  data: DataTransfer,
  schema: Schema<N>,
): ClipboardFragment<N> | null {
  const local = fragments.get(data.getData(mime));

  if (local) return local.read(schema);
  const source = data.getData('text/html');

  if (!source) return null;
  const { nodes } = importHtml(source);

  if (!nodes.length) return null;

  return {
    nodes: createDocumentCodec(schema).decode(demoDocumentCodec.encode(nodes)),
    inline: nodes.length === 1 && nodes[0].kind === 'paragraph',
  };
}

export function pasteFragment<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  fragment: ClipboardFragment<N>,
  allocate: () => NodeIdentity,
) {
  if (fragment.nodes.length === 1 && schema.node(table).matches(fragment.nodes[0])) {
    const rectangle = pasteCellRectangle(schema, state, fragment.nodes[0], allocate);

    if (rectangle) return rectangle;
  }

  const inserted = fragment.nodes.map((node) => schema.copy(node, allocate));
  const all = indexTree(schema, inserted).order;

  for (const { node } of all) {
    const text = schema.text(node);

    if (text !== null && !supportsOwnedText(text))
      throw new Error('This study currently supports Latin text and emoji.');
  }

  const ranges = state.selection.ranges(selectionContext(schema, state.nodes)),
    selected = new Map(ranges.map((r) => [r.id, r]));

  function covered(node: N): boolean {
    const r = selected.get(node.id);

    if (r?.kind === 'node') return true;
    const text = schema.text(node);

    if (text !== null) return r?.kind === 'text' && r.from === 0 && r.to === text.length;
    const children = schema.children(node);

    return children.length > 0 && children.every(covered);
  }

  let target = [...all].toReversed().find((entry) => schema.text(entry.node) !== null)?.node;

  if (!target) {
    target = schema.node(paragraph).create(allocate(), { text: '' });
    inserted.push(target);
  }

  const selection = textSelection(target.id, schema.text(target)?.length ?? 0);

  if (state.nodes.every(covered))
    return {
      steps: [
        {
          kind: 'replaceChildren',
          parent: null,
          index: 0,
          count: state.nodes.length,
          nodes: inserted,
        } satisfies Step<N>,
      ],
      selection,
    };

  if (state.selection instanceof NodeSelection) {
    const location = selectionContext(schema, state.nodes).location(state.selection.id);

    if (!location) throw new Error('Missing paste destination');

    return {
      steps: [
        {
          kind: 'replaceChildren',
          ...location,
          count: 1,
          nodes: inserted,
        } satisfies Step<N>,
      ],
      selection,
    };
  }

  if (state.selection instanceof RangeSelection && !ranges.some((range) => range.kind === 'text')) {
    const first = ranges[0],
      point = state.selection.anchor,
      location = selectionContext(schema, state.nodes).location(first?.id ?? point.id);

    if (!location) throw new Error('Missing structural paste destination');

    const index =
      location.index + (!first && point.kind === 'node' && point.side === 'after' ? 1 : 0);

    const removal = state.selection.replace(selectionContext(schema, state.nodes), '');

    return {
      steps: [
        ...removal.steps,
        {
          kind: 'insertChildren',
          parent: location.parent,
          index,
          nodes: inserted,
        } satisfies Step<N>,
      ],
      selection,
    };
  }

  const removal = replaceStructuredText(schema, state, '');

  const preview = applyTransaction(schema, state, {
    baseRevision: state.revision,
    origin: 'local',
    history: 'separate',
    time: 0,
    ...removal,
  }).state;

  const caret = preview.selection.ranges(selectionContext(schema, preview.nodes))[0];

  if (!caret || caret.kind !== 'text') throw new Error('Paste needs a text destination');
  const entry = indexTree(schema, preview.nodes).byId.get(caret.id);

  if (!entry) throw new Error('Missing paste destination');

  const tail = allocate(),
    length = schema.text(entry.node)?.length ?? 0;

  const steps: Step<N>[] = [
    ...removal.steps,
    { kind: 'split', id: caret.id, at: caret.from, rightId: tail.id, rightKey: tail.key },
  ];

  if (fragment.inline && inserted.length === 1 && schema.text(inserted[0]) !== null) {
    steps.push(
      { kind: 'insertChildren', parent: entry.parent, index: entry.index + 1, nodes: inserted },
      { kind: 'join', left: caret.id, right: inserted[0].id },
      { kind: 'join', left: caret.id, right: tail.id },
    );

    return {
      steps,
      selection: textSelection(caret.id, caret.from + (schema.text(inserted[0])?.length ?? 0)),
    };
  }

  let index = entry.index;

  if (caret.from === 0)
    steps.push({ kind: 'removeChildren', parent: entry.parent, index, count: 1 });
  else index++;

  if (caret.from === length)
    steps.push({ kind: 'removeChildren', parent: entry.parent, index, count: 1 });
  steps.push({ kind: 'insertChildren', parent: entry.parent, index, nodes: inserted });

  return { steps, selection };
}
