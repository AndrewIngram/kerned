import { createDocumentQuery } from '../../editor-browser/document';
import type { Schema } from '../../model';
import type { EditorState } from '../../state';
import type { StarterNode, StarterLeaf } from '../demo-model';
import { selectedBlockLabel } from '../headings';

type BlockDecoration = {
  inset: number;
  quotes: readonly { id: number; inset: number }[];
  marker: string;
};

/** Starter-specific container appearance and toolbar labels over the shared view projection. */
export function createStarterDocumentQuery(schema: Schema<StarterNode>) {
  const project = createDocumentQuery<StarterNode, StarterLeaf, BlockDecoration>(schema, {
    initial: { inset: 0, quotes: [], marker: '' },
    isBlock: (node): node is StarterLeaf =>
      node.kind === 'paragraph' ||
      node.kind === 'heading' ||
      node.kind === 'image' ||
      node.kind === 'table',
    child: (parent, index, context) => {
      switch (parent.kind) {
        case 'quote':
          return {
            inset: context.inset + 24,
            quotes: [...context.quotes, { id: parent.id, inset: context.inset }],
            marker: '',
          };
        case 'list':
          return {
            ...context,
            inset: context.inset + 28,
            marker: parent.ordered ? `${parent.start + index}.` : '•',
          };
        case 'listItem':
          return { ...context, marker: index === 0 ? context.marker : '' };
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

export type EditorDocument = ReturnType<ReturnType<typeof createStarterDocumentQuery>>;
