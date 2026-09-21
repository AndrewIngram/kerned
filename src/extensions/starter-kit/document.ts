import { indexTree, type Schema } from '../../model';
import { selectionContext, selectionView, type EditorState } from '../../state';
import { projectBlocks } from '../blocks';
import type { StarterNode } from '../demo-model';
import { selectedBlockLabel } from '../headings';

/** Projection caches belong to one extension instance; draft snapshots can be collected. */
export function createStarterDocumentQuery(schema: Schema<StarterNode>) {
  const contents = new WeakMap<readonly StarterNode[], ReturnType<typeof content>>();

  function content(roots: readonly StarterNode[]) {
    const projection = projectBlocks(roots);
    const tree = indexTree(schema, roots);
    const context = selectionContext(schema, roots, tree);
    const nodeIndexes = new Map(projection.nodes.map((node, index) => [node.id, index]));

    return { projection, tree, context, nodeIndexes };
  }

  function projectState(editorState: EditorState<StarterNode>) {
    let current = contents.get(editorState.nodes);

    if (!current) {
      current = content(editorState.nodes);
      contents.set(editorState.nodes, current);
    }

    const { projection, tree, context, nodeIndexes } = current;
    const { nodes } = projection;
    const view = selectionView(schema, editorState.selection, context, nodeIndexes);
    const active = view.focusId === null ? undefined : tree.byId.get(view.focusId)?.node;
    const selectedBlocks: StarterNode[] = [];
    const seen = new Set<number>();

    function include(id: number) {
      if (seen.has(id)) return;
      seen.add(id);
      const node = tree.byId.get(id)?.node;

      if (!node) return;

      if (nodeIndexes.has(id) || schema.text(node) !== null) selectedBlocks.push(node);
      else schema.children(node).forEach((child) => include(child.id));
    }

    const anchorIndex = view.textSelection
      ? nodeIndexes.get(view.textSelection.anchor.id)
      : undefined;

    const headIndex = view.textSelection ? nodeIndexes.get(view.textSelection.head.id) : undefined;

    if (anchorIndex !== undefined && headIndex !== undefined) {
      for (const node of nodes.slice(
        Math.min(anchorIndex, headIndex),
        Math.max(anchorIndex, headIndex) + 1,
      )) {
        if (
          view.collapsed ||
          node.id !== view.end?.id ||
          view.end.offset > 0 ||
          view.start?.id === view.end.id
        )
          include(node.id);
      }
    } else
      for (const range of view.ranges) {
        if (
          range.kind === 'node' ||
          range.to > range.from ||
          view.collapsed ||
          view.nonTextSelection
        )
          include(range.id);
      }

    const blockLabel = selectedBlockLabel(schema, editorState, tree);

    return {
      ...view,
      editorState,
      projection,
      nodes,
      tree,
      context,
      nodeIndexes,
      active,
      selectedBlocks,
      blockLabel,
    };
  }

  // Toolbar queries often ask about every selected block. Cache the selection
  // projection as well as the tree so repeated queries stay linear in selection size.
  const snapshots = new WeakMap<EditorState<StarterNode>, ReturnType<typeof projectState>>();

  return (state: EditorState<StarterNode>) => {
    let snapshot = snapshots.get(state);

    if (!snapshot) {
      snapshot = projectState(state);
      snapshots.set(state, snapshot);
    }

    return snapshot;
  };
}

export type EditorDocument = ReturnType<ReturnType<typeof createStarterDocumentQuery>>;
