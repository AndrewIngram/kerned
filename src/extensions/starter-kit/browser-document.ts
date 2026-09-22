import type { Schema } from '@gprose/model';
import type { EditorState } from '@gprose/state';
import { createDocumentQuery } from '@gprose/view';

import type { StarterNode, StarterLeaf } from '../demo-model';
import { selectedBlockLabel } from '../headings';

type BlockDecoration = { inset: number };

/** Starter-specific container appearance and toolbar labels over the shared view projection. */
export function createStarterDocumentQuery(schema: Schema<StarterNode>) {
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

export type EditorDocument = ReturnType<ReturnType<typeof createStarterDocumentQuery>>;
