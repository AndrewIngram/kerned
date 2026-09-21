import type { selectionView } from '../../editor-browser';
import type { indexTree } from '../../model';
import type { createOwnedEngine } from '../../owned-layout';
import type { createEditor, EditorState, SelectionContext } from '../../state';
import type { projectBlocks } from '../blocks';
import type { StarterLeaf, StarterNode } from '../demo-model';
import type { selectedBlockLabel } from '../headings';

export type Owned = Awaited<ReturnType<typeof createOwnedEngine>>;

export type EditorSession = ReturnType<typeof createEditor<StarterNode>>;

/** Shared semantic snapshot. Commands depend on this data, not the React hook
 * that memoizes it for a view. All consumers reuse the same document index. */
export type EditorDocument = ReturnType<typeof selectionView<StarterNode>> & {
  editorState: EditorState<StarterNode>;
  projection: ReturnType<typeof projectBlocks>;
  nodes: StarterLeaf[];
  tree: ReturnType<typeof indexTree<StarterNode>>;
  context: SelectionContext;
  nodeIndexes: ReadonlyMap<number, number>;
  active: StarterNode | undefined;
  selectedBlocks: StarterNode[];
  blockLabel: ReturnType<typeof selectedBlockLabel>;
};
