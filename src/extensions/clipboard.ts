import { indexTree, type NodeIdentity, type Schema } from '../model';
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
import { plainText, type StarterNode } from './demo-model';
import { importHtml } from './html';
import { copyCellRectangle, cellRectangleText, pasteCellRectangle } from './table-clipboard';

type Fragment = { nodes: StarterNode[]; inline: boolean };

const mime = 'application/x-gprose-fragment';

// The token refers only to immutable fragments created in this page. Untrusted
// clipboard JSON never becomes editor state; other pages use the inert HTML importer.
const fragments = new Map<string, Fragment>();

const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function html(node: StarterNode): string {
  switch (node.kind) {
    case 'paragraph':
    case 'heading': {
      const edges = [
        ...new Set([
          0,
          node.text.length,
          ...node.marks.flatMap((s) => [s.from, s.to]),
          ...node.inline.flatMap((a) => [a.index, a.index + 1]),
        ]),
      ].toSorted((a, b) => a - b);

      let body = '';

      for (let i = 0; i < edges.length - 1; i++) {
        const from = edges[i],
          to = edges[i + 1],
          marks = node.marks.filter((s) => s.from <= from && s.to >= to);

        let part = escape(plainText(node, from, to)).replaceAll('\n', '<br>');

        if (marks.some((s) => s.mark.type === 'bold')) part = `<strong>${part}</strong>`;

        if (marks.some((s) => s.mark.type === 'italic')) part = `<em>${part}</em>`;

        if (marks.some((s) => s.mark.type === 'underline')) part = `<u>${part}</u>`;
        body += part;
      }

      const tag = node.kind === 'heading' ? `h${node.level}` : 'p';

      return `<${tag}>${body}</${tag}>`;
    }

    case 'quote':
      return `<blockquote>${node.children.map(html).join('')}</blockquote>`;
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';

      return `<${tag} start="${node.start}">${node.children.map(html).join('')}</${tag}>`;
    }

    case 'listItem':
      return `<li>${node.children.map(html).join('')}</li>`;
    case 'table':
      return `<table><caption>${escape(node.caption)}</caption>${node.rows.map((row) => `<tr>${row.map(html).join('')}</tr>`).join('')}</table>`;
    case 'tableCell': {
      const tag = node.header ? 'th' : 'td';

      return `<${tag} colspan="${node.colspan}" rowspan="${node.rowspan}">${node.paragraphs.map(html).join('')}</${tag}>`;
    }

    case 'image':
      return `<p>${escape(node.alt)}</p>`;
    case 'checklist':
      return `<p>${escape(node.notes || '[Checklist]')}</p>`;
    default: {
      const exhaustive: never = node;
      throw new Error(String(exhaustive));
    }
  }
}

export function writeClipboard(
  data: DataTransfer,
  schema: Schema<StarterNode>,
  state: EditorState<StarterNode>,
  text: string,
) {
  const ranges = state.selection.ranges(selectionContext(schema, state.nodes)),
    byId = new Map(ranges.map((r) => [r.id, r]));

  function slice(node: StarterNode): StarterNode[] {
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
    (nodes[0].kind === 'paragraph' || nodes[0].kind === 'heading') &&
    ranges.some(
      (r) => r.kind === 'text' && (r.from > 0 || r.to < (context.text(r.id)?.length ?? 0)),
    );

  const token = crypto.randomUUID();
  fragments.set(token, { nodes, inline });

  if (fragments.size > 8) {
    const first = fragments.keys().next().value;

    if (first) fragments.delete(first);
  }

  data.setData('text/plain', rectangle ? cellRectangleText(rectangle) : text);
  data.setData('text/html', nodes.map(html).join(''));
  data.setData(mime, token);
}

export function readClipboard(data: DataTransfer): Fragment | null {
  const local = fragments.get(data.getData(mime));

  if (local) return local;
  const source = data.getData('text/html');

  if (!source) return null;
  const { nodes } = importHtml(source);

  if (!nodes.length) return null;

  return { nodes, inline: nodes.length === 1 && nodes[0].kind === 'paragraph' };
}

export function pasteFragment(
  schema: Schema<StarterNode>,
  state: EditorState<StarterNode>,
  fragment: Fragment,
  allocate: () => NodeIdentity,
) {
  if (fragment.nodes.length === 1 && fragment.nodes[0].kind === 'table') {
    const rectangle = pasteCellRectangle(schema, state, fragment.nodes[0], allocate);

    if (rectangle) return rectangle;
  }

  function clone(node: StarterNode): StarterNode {
    const children = schema.children(node);

    const copy: StarterNode =
      node.kind === 'paragraph' || node.kind === 'heading'
        ? {
            ...node,
            ...allocate(),
            inline: node.inline.map((a) => ({ ...a, id: crypto.randomUUID() })),
          }
        : { ...node, ...allocate() };

    return children.length ? schema.withChildren(copy, children.map(clone)) : copy;
  }

  const inserted = fragment.nodes.map(clone);
  const all = indexTree(schema, inserted).order;

  for (const { node } of all) {
    const text = schema.text(node);

    if (text !== null && !supportsOwnedText(text))
      throw new Error('This study currently supports Latin text and emoji.');
  }

  const ranges = state.selection.ranges(selectionContext(schema, state.nodes)),
    selected = new Map(ranges.map((r) => [r.id, r]));

  function covered(node: StarterNode): boolean {
    const r = selected.get(node.id);

    if (r?.kind === 'node') return true;
    const text = schema.text(node);

    if (text !== null) return r?.kind === 'text' && r.from === 0 && r.to === text.length;
    const children = schema.children(node);

    return children.length > 0 && children.every(covered);
  }

  let target = [...all].toReversed().find((entry) => schema.text(entry.node) !== null)?.node;

  if (!target) {
    target = { kind: 'paragraph', ...allocate(), text: '', marks: [], inline: [] };
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
        } satisfies Step<StarterNode>,
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
        } satisfies Step<StarterNode>,
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
        } satisfies Step<StarterNode>,
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

  const steps: Step<StarterNode>[] = [
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
