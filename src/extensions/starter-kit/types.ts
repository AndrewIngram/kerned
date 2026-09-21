import type {
  createEditor,
  EditorState,
  indexTree,
  SelectionContext,
  selectionView,
} from '../../editor';
import type { createOwnedEngine } from '../../owned-layout';
import type { projectBlocks } from '../blocks';
import type { HybridLeaf, HybridNode } from '../demo-model';
import type { selectedBlockLabel } from '../headings';

export type Owned = Awaited<ReturnType<typeof createOwnedEngine>>;

export type EditorSession = ReturnType<typeof createEditor<HybridNode>>;

/** Shared semantic snapshot. Commands depend on this data, not the React hook
 * that memoizes it for a view. All consumers reuse the same document index. */
export type EditorDocument = ReturnType<typeof selectionView<HybridNode>> & {
  editorState: EditorState<HybridNode>;
  projection: ReturnType<typeof projectBlocks>;
  nodes: HybridLeaf[];
  tree: ReturnType<typeof indexTree<HybridNode>>;
  context: SelectionContext;
  nodeIndexes: ReadonlyMap<number, number>;
  active: HybridNode | undefined;
  selectedBlocks: HybridNode[];
  blockLabel: ReturnType<typeof selectedBlockLabel>;
};
