import { indexTree, type Schema } from '@gprose/model';
import { selectionContext, type EditorState } from '@gprose/state';
import { createDocumentQuery } from '@gprose/view';

import type { StarterNode, StarterLeaf } from './demo-model.js';

type BlockDecoration = { inset: number };

/** Starter-specific container appearance and toolbar labels over the shared view projection. */
export function createDemoDocumentQuery(schema: Schema<StarterNode>) {
  const project = createDocumentQuery<StarterNode, StarterLeaf, BlockDecoration>(schema, {
    initial: { inset: 0 },
    isBlock: (node): node is StarterLeaf =>
      node.kind === 'paragraph' ||
      node.kind === 'heading' ||
      node.kind === 'image' ||
      node.kind === 'table',
    child: (parent, _index, context) => {
      switch (parent.kind) {
        case 'quote':
          return { inset: context.inset + 24 };
        case 'list':
          return { inset: context.inset + 28 };
        case 'listItem':
          return context;
        default:
          throw new Error(`Unexpected flowing container: ${parent.kind}`);
      }
    },
  });

  function describe(state: EditorState<StarterNode>) {
    const value = project(state);

    return { ...value, blockLabel: selectedBlockLabel(schema, state, value.tree) };
  }

  const snapshots = new WeakMap<EditorState<StarterNode>, ReturnType<typeof describe>>();

  return (state: EditorState<StarterNode>) => {
    let value = snapshots.get(state);

    if (!value) {
      value = describe(state);
      snapshots.set(state, value);
    }

    return value;
  };
}

export type EditorDocument = ReturnType<ReturnType<typeof createDemoDocumentQuery>>;

/** The nearest structural wrapper describes ordinary text; headings keep their level. */
export function selectedBlockLabel(
  schema: Schema<StarterNode>,
  state: EditorState<StarterNode>,
  tree = indexTree(schema, state.nodes),
) {
  const context = selectionContext(schema, state.nodes, tree),
    empty = state.selection.isEmpty(context);

  const labels = new Set<string>();
  const ranges = state.selection.ranges(context);

  for (const range of ranges) {
    if (
      !empty &&
      range === ranges.at(-1) &&
      range.kind === 'text' &&
      range.from === 0 &&
      range.to === 0
    )
      continue;
    let entry = tree.byId.get(range.id);

    if (!entry) continue;
    const node = entry.node;

    if (node.kind === 'heading') {
      labels.add(`Heading ${node.level}`);
      continue;
    }

    let label = node.kind === 'image' ? 'Image' : 'Paragraph';

    while (entry) {
      if (entry.node.kind === 'table' || entry.node.kind === 'tableCell') {
        label = 'Table';
        break;
      }

      if (entry.node.kind === 'list') {
        label = entry.node.ordered ? 'Numbered list' : 'Bullet list';
        break;
      }

      entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
    }

    labels.add(label);

    if (labels.size > 1) return 'Mixed';
  }

  return labels.size > 1 ? 'Mixed' : (labels.values().next().value ?? 'Paragraph');
}
