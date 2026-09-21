import {
  indexTree,
  type NodeExtension,
  type Schema,
  type NodeIdentity,
  type SelectionRange,
} from '../model';
import {
  type EditorState,
  RangeSelection,
  selectionContext,
  TextSelection,
  textSelection,
} from '../state';
import { type Step } from '../transform';
import type { StarterNode, StarterLeaf } from './demo-model';
import { createListExtensions } from './lists';

export const listCommands = createListExtensions<StarterNode>({
  list: (node) => (node.kind === 'list' ? node : null),
  item: (node) => (node.kind === 'listItem' ? node : null),
  isBlock: (node) => node.kind !== 'list' && node.kind !== 'listItem' && node.kind !== 'tableCell',
  withChildren(node, children) {
    if (!('children' in node)) throw new Error('Expected a container');

    return { ...node, children };
  },
  createList: (identity, settings) => ({ kind: 'list', ...identity, ...settings, children: [] }),
  createItem: (identity) => ({ kind: 'listItem', ...identity, children: [] }),
});

export const quoteExtension: NodeExtension<StarterNode> = {
  name: 'quote',
  version: 1,
  kind: 'container',
  accepts: (node) => node.kind === 'quote',
  validateUpdate() {},
  content: {
    children: (node) => ('children' in node ? node.children : []),
    withChildren(node, children) {
      if (node.kind !== 'quote') throw new Error('Expected quote');

      return { ...node, children };
    },
    validateChildren(_node, children) {
      if (!children.length || children.some((n) => n.kind === 'listItem'))
        throw new Error('Quotes require block children');
    },
  },
};

export type BlockDecoration = {
  inset: number;
  quotes: readonly { id: number; inset: number }[];
  marker: string;
};

export function projectBlocks(roots: StarterNode[]) {
  const nodes: StarterLeaf[] = [],
    decorations = new Map<number, BlockDecoration>();

  function visit(
    node: StarterNode,
    inset: number,
    quotes: readonly { id: number; inset: number }[],
    marker = '',
  ) {
    if (node.kind === 'quote') {
      node.children.forEach((child) =>
        visit(child, inset + 24, [...quotes, { id: node.id, inset }]),
      );

      return;
    }

    if (node.kind === 'list') {
      node.children.forEach((child, index) =>
        visit(child, inset + 28, quotes, node.ordered ? `${node.start + index}.` : '•'),
      );

      return;
    }

    if (node.kind === 'listItem') {
      node.children.forEach((child, index) =>
        visit(child, inset, quotes, index === 0 ? marker : ''),
      );

      return;
    }

    if (node.kind === 'tableCell') throw new Error('Table cells must belong to a table');
    nodes.push(node);
    decorations.set(node.id, { inset, quotes, marker });
  }

  roots.forEach((node) => visit(node, 0, []));

  return { nodes, decorations };
}

export function blockCommands(
  schema: Schema<StarterNode>,
  state: EditorState<StarterNode>,
  ids: number[],
  allocate: () => NodeIdentity,
  tree = indexTree(schema, state.nodes),
) {
  const entries = ids.flatMap((id) => {
    const entry = tree.byId.get(id);

    return entry ? [entry] : [];
  });

  const first = entries[0];

  function ancestor(kind: 'quote' | 'list' | 'listItem') {
    let entry: typeof first | undefined = first;

    while (entry) {
      if (entry.node.kind === kind) return entry;
      entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
    }

    return undefined;
  }

  function siblings() {
    if (!first || entries.some((e) => e.parent !== first.parent))
      throw new Error('Select blocks in the same container');

    const indexes = entries.map((e) => e.index),
      index = Math.min(...indexes),
      last = Math.max(...indexes);

    return { parent: first.parent, index, count: last - index + 1 };
  }

  return {
    item: ancestor('listItem')?.node.id,
    quoted:
      entries.length > 0 &&
      entries.every((entry) => {
        while (entry) {
          if (entry.node.kind === 'quote') return true;
          const parent = entry.parent === null ? undefined : tree.byId.get(entry.parent);

          if (!parent) return false;
          entry = parent;
        }

        return false;
      }),
    quote(): Step<StarterNode>[] {
      if (!entries.length) return [];

      const ancestors = (id: number) => {
        const result: number[] = [];
        let entry = tree.byId.get(id);

        while (entry) {
          result.push(entry.node.id);
          entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
        }

        return result;
      };

      const paths = entries.map((entry) => ancestors(entry.node.id));
      const existing = ancestor('quote');

      if (existing && paths.every((path) => path.includes(existing.node.id)))
        return [{ kind: 'unwrap', id: existing.node.id }];

      // Lift the range to its nearest shared container. A list remains a list inside
      // the quote, and existing quotes in the range contribute their children.
      const parent =
        paths[0].slice(1).find((id) => paths.every((path) => path.slice(1).includes(id))) ?? null;

      const children = parent === null ? state.nodes : schema.children(tree.byId.get(parent)!.node);
      const indexes = paths.map((path) => children.findIndex((node) => path.includes(node.id)));

      const index = Math.min(...indexes),
        last = Math.max(...indexes);

      return [
        {
          kind: 'replaceChildren',
          parent,
          index,
          count: last - index + 1,
          nodes: [
            {
              kind: 'quote',
              ...allocate(),
              children: children.slice(index, last + 1).flatMap(flatten),
            },
          ],
        },
      ];
    },
    list(ordered: boolean): Step<StarterNode>[] {
      const existing = ancestor('list');

      if (existing?.node.kind === 'list') {
        if (existing.node.ordered !== ordered)
          return [{ kind: 'updateBlock', node: { ...existing.node, ordered } }];

        return [
          ...existing.node.children.map((item) => ({ kind: 'unwrap' as const, id: item.id })),
          { kind: 'unwrap', id: existing.node.id },
        ];
      }

      const range = siblings();

      return listCommands.wrap(
        schema,
        state,
        range.parent,
        range.index,
        range.count,
        { ordered, start: 1 },
        allocate,
      ).steps;
    },
  };
}

/** Join selected text across quote/list boundaries without flattening the document. */
export function replaceStructuredText(
  schema: Schema<StarterNode>,
  state: EditorState<StarterNode>,
  text: string,
) {
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
            if (
              entry.node.kind === 'quote' ||
              entry.node.kind === 'list' ||
              entry.node.kind === 'listItem'
            )
              prune.add(entry.node.id);
            entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
          }
        }

        return { ...step, pruneEmpty: [...prune] };
      }),
    };
  }

  if (!(state.selection instanceof TextSelection)) throw new Error('Expected text selection');

  const selection = state.selection,
    leaves = projectBlocks(state.nodes).nodes;

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

  if (first?.kind !== 'paragraph' && first?.kind !== 'heading')
    throw new Error('Expected text start');

  const ranges: SelectionRange[] = chosen.map((node) =>
    node.kind === 'paragraph' || node.kind === 'heading'
      ? {
          kind: 'text',
          id: node.id,
          from: node.id === start.id ? start.offset : 0,
          to: node.id === end.id ? end.offset : node.text.length,
        }
      : { kind: 'node', id: node.id },
  );

  const pruneEmpty = indexTree(schema, state.nodes).order.flatMap(({ node }) =>
    node.kind === 'quote' || node.kind === 'list' || node.kind === 'listItem' ? [node.id] : [],
  );

  const steps: Step<StarterNode>[] = [{ kind: 'replaceRanges', ranges, text, pruneEmpty }];

  return { steps, selection: textSelection(first.id, start.offset + text.length) };
}

const flatten = (node: StarterNode): StarterNode[] =>
  node.kind === 'quote' ? node.children.flatMap(flatten) : [node];
