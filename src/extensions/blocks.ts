import { indexTree, type Schema, type NodeIdentity, type SelectionRange } from '../model';
import {
  type EditorState,
  RangeSelection,
  selectionContext,
  TextSelection,
  textSelection,
} from '../state';
import { type Step } from '../transform';
import { createBlockCommands } from './block-commands';
import type { StarterNode } from './demo-model';
import { createListCommands, type ListAdapter } from './lists';
import { quote, list, listItem, table } from './starter-definitions';

const starterList: ListAdapter<StarterNode> = {
  list: (node) => (node.kind === 'list' ? node : null),
  item: (node) => (node.kind === 'listItem' ? node : null),
  isBlock: (node) => node.kind !== 'list' && node.kind !== 'listItem' && node.kind !== 'tableCell',
  createList: (identity, settings) => ({ kind: 'list', ...identity, ...settings, children: [] }),
  createItem: (identity) => ({ kind: 'listItem', ...identity, children: [] }),
};

export const listCommands = createListCommands(starterList);

export const blockCommands = createBlockCommands<StarterNode>({
  list: starterList,
  isQuote: (node) => node.kind === 'quote',
  createQuote: (identity) => ({ kind: 'quote', ...identity, children: [] }),
  withOrdered: (node, ordered) => ({ ...node, ordered }),
});

/** Join selected text across quote/list boundaries without flattening the document. */
export function replaceStructuredText<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  text: string,
) {
  const wrappers = [schema.node(quote), schema.node(list), schema.node(listItem)];
  const prunable = (node: N) => wrappers.some((type) => type.matches(node));

  if (state.selection instanceof RangeSelection) {
    const edit = state.selection.replace(selectionContext(schema, state.nodes), text);
    const tree = indexTree(schema, state.nodes);

    return {
      ...edit,
      steps: edit.steps.map((step) => {
        if (step.kind !== 'replaceRanges') return step;
        const prune = new Set<number>();

        for (const range of step.ranges) {
          let entry = tree.byId.get(range.id);

          while (entry) {
            if (prunable(entry.node)) prune.add(entry.node.id);
            entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
          }
        }

        return { ...step, pruneEmpty: [...prune] };
      }),
    };
  }

  if (!(state.selection instanceof TextSelection)) throw new Error('Expected text selection');

  const selection = state.selection;
  const tables = schema.node(table);
  const leaves: N[] = [];

  function visit(node: N) {
    const children = schema.children(node);

    if (!children.length || tables.matches(node)) leaves.push(node);
    else children.forEach(visit);
  }

  state.nodes.forEach(visit);

  const ai = leaves.findIndex((n) => n.id === selection.anchor.id),
    hi = leaves.findIndex((n) => n.id === selection.head.id);

  if (ai < 0 || hi < 0) throw new Error('Cross-cell text replacement requires a cell selection');

  const start =
    ai < hi || (ai === hi && selection.anchor.offset <= selection.head.offset)
      ? selection.anchor
      : selection.head;

  const end = start === selection.anchor ? selection.head : selection.anchor;

  const chosen = leaves.slice(Math.min(ai, hi), Math.max(ai, hi) + 1),
    first = chosen[0];

  if (!first || schema.text(first) === null) throw new Error('Expected text start');

  const ranges: SelectionRange[] = chosen.map((node) => {
    const value = schema.text(node);

    return value === null
      ? { kind: 'node', id: node.id }
      : {
          kind: 'text',
          id: node.id,
          from: node.id === start.id ? start.offset : 0,
          to: node.id === end.id ? end.offset : value.length,
        };
  });

  const pruneEmpty = indexTree(schema, state.nodes).order.flatMap(({ node }) =>
    prunable(node) ? [node.id] : [],
  );

  const steps: Step<N>[] = [{ kind: 'replaceRanges', ranges, text, pruneEmpty }];

  return { steps, selection: textSelection(first.id, start.offset + text.length) };
}
