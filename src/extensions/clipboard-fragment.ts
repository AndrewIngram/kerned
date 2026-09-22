import { indexTree, validateTree, type NodeIdentity, type Schema } from '@gprose/model';
import {
  RangeSelection,
  NodeSelection,
  TextSelection,
  applyTransaction,
  selectionContext,
  textSelection,
  type EditorState,
} from '@gprose/state';
import type { Step } from '@gprose/transform';
import { supportsLayoutText } from '@gprose/view/text';

import { replaceStructuredText } from './blocks';
import type { StarterNode } from './demo-model';
import { paragraph, table, tableCell, list, listItem } from './starter-definitions';
import { copyCellRectangle, pasteCellRectangle } from './table-clipboard';

export type ClipboardFragment<N = StarterNode> = { nodes: readonly N[]; inline: boolean };

/** Extract a closed fragment. Text inside one block does not bring its ancestors;
 * partial lists retain selected list runs, and partial table text is ordinary
 * block content. Rectangular cell selections use their own grid extraction. */
export function copyFragment<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
): ClipboardFragment<N> {
  const rectangle = copyCellRectangle(schema, state);

  if (rectangle) return { nodes: [rectangle], inline: false };
  const tree = indexTree(schema, state.nodes);
  const context = selectionContext(schema, state.nodes, tree);
  const ranges = state.selection.ranges(context);
  const byId = new Map(ranges.map((range) => [range.id, range]));

  let nextId = 0;

  function slice(node: N): N[] {
    const range = byId.get(node.id);

    if (range?.kind === 'node') return [node];

    if (range?.kind === 'text') {
      if (range.from === range.to)
        return schema.text(node) === '' && ranges.length > 1 ? [node] : [];

      if (range.from === 0 && range.to === schema.text(node)?.length) return [node];

      const editing = schema.editing(node),
        left = editing.split(node, range.to, node)[0];

      return [range.from ? editing.split(left, range.from, node)[1] : left];
    }

    const children = schema.children(node);
    const selected = children.flatMap(slice);

    if (!selected.length) return [];

    if (
      selected.length === children.length &&
      selected.every((child, index) => child === children[index])
    )
      return [node];

    // A selection starting in a sublist has not selected its parent's leading
    // block. Promote the sublist instead of manufacturing that missing content.
    if (schema.isNode(node, listItem) && schema.isNode(selected[0], list)) return selected;

    if (schema.isNode(node, list)) {
      const result: N[] = [];

      let run: N[] = [],
        count = 0;

      function flush() {
        if (!run.length) return;
        let wrapper = schema.withChildren(node, run);

        if (count++) {
          if (!nextId)
            nextId = tree.order.reduce((max, entry) => Math.max(max, entry.node.id), 0) + 1;
          wrapper = Object.freeze({ ...wrapper, id: nextId++, key: crypto.randomUUID() });
        }

        result.push(wrapper);
        run = [];
      }

      for (const child of selected) {
        if (schema.isNode(child, listItem)) run.push(child);
        else {
          flush();
          result.push(child);
        }
      }

      flush();

      return result;
    }

    // A text selection is not a cell rectangle. Do not invent cells or retain
    // a sparse grid when only some of a table's text was selected.
    if (schema.isNode(node, table) || schema.isNode(node, tableCell))
      return selected.flatMap((child) =>
        schema.isNode(child, tableCell) ? schema.children(child) : [child],
      );

    return [schema.withChildren(node, selected)];
  }

  const single = ranges.length === 1 ? tree.byId.get(ranges[0].id)?.node : undefined;
  const nodes = single && schema.text(single) !== null ? slice(single) : state.nodes.flatMap(slice);
  validateTree(schema, nodes);

  return {
    nodes,
    inline:
      nodes.length === 1 &&
      schema.text(nodes[0]) !== null &&
      ranges.some(
        (range) =>
          range.kind === 'text' &&
          (range.from > 0 || range.to < (context.text(range.id)?.length ?? 0)),
      ),
  };
}

export function pasteFragment<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  fragment: ClipboardFragment<N>,
  allocate: () => NodeIdentity,
) {
  if (fragment.nodes.length === 1 && schema.isNode(fragment.nodes[0], table)) {
    const rectangle = pasteCellRectangle(schema, state, fragment.nodes[0], allocate);

    if (rectangle) return rectangle;
  }

  const inserted = fragment.nodes.map((node) => schema.copy(node, allocate));
  const all = indexTree(schema, inserted).order;

  for (const { node } of all) {
    const text = schema.text(node);

    if (text !== null && !supportsLayoutText(text))
      throw new Error('This study currently supports Latin text and emoji.');
  }

  const tree = indexTree(schema, state.nodes),
    context = selectionContext(schema, state.nodes, tree),
    ranges = state.selection.ranges(context),
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
    const location = context.location(state.selection.id);

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
      location = context.location(first?.id ?? point.id);

    if (!location) throw new Error('Missing structural paste destination');

    const index =
      location.index + (!first && point.kind === 'node' && point.side === 'after' ? 1 : 0);

    const removal = state.selection.replace(context, '');

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

  const steps: Step<N>[] = [];

  let destination = tree,
    caret = ranges[0];

  if (!(state.selection instanceof TextSelection && state.selection.isEmpty(context))) {
    const removal = replaceStructuredText(schema, state, '');

    const preview = applyTransaction(schema, state, {
      baseRevision: state.revision,
      origin: 'local',
      history: 'separate',
      time: 0,
      ...removal,
    });

    steps.push(...removal.steps);
    destination = preview.tree;
    caret = preview.state.selection.ranges(
      selectionContext(schema, preview.state.nodes, destination),
    )[0];
  }

  if (!caret || caret.kind !== 'text') throw new Error('Paste needs a text destination');
  const entry = destination.byId.get(caret.id);

  if (!entry) throw new Error('Missing paste destination');

  const tail = allocate(),
    length = schema.text(entry.node)?.length ?? 0;

  steps.push({ kind: 'split', id: caret.id, at: caret.from, rightId: tail.id, rightKey: tail.key });

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
