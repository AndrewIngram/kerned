import type { StarterNode } from '../demo-model';
import { useMemo } from 'react';
import { indexTree, selectionContext, selectionView } from '../../editor';
import { useEditorState } from '../../editor-react';
import { projectBlocks } from '../blocks';
import { demoSchema } from '../demo-schema';
import { selectedBlockLabel } from '../headings';
import type { EditorDocument, EditorSession } from './types';

/** One index per document snapshot, shared by commands, selection and the view. */
export function useEditorDocument(editor: EditorSession): EditorDocument {
  const editorState = useEditorState(editor, (state) => state);
  const projection = useMemo(() => projectBlocks(editorState.nodes), [editorState.nodes]);
  const { nodes } = projection;
  const tree = useMemo(() => indexTree(demoSchema, editorState.nodes), [editorState.nodes]);

  const context = useMemo(
    () => selectionContext(demoSchema, editorState.nodes, tree),
    [editorState.nodes, tree],
  );

  const nodeIndexes = useMemo(() => new Map(nodes.map((node, index) => [node.id, index])), [nodes]);
  const view = selectionView(demoSchema, editorState.selection, context, nodeIndexes);
  const active = view.focusId === null ? undefined : tree.byId.get(view.focusId)?.node;
  const selectedBlocks: StarterNode[] = [];
  const seen = new Set<number>();

  function include(id: number) {
    if (seen.has(id)) return;
    seen.add(id);
    const node = tree.byId.get(id)?.node;

    if (!node) return;

    if (nodeIndexes.has(id) || demoSchema.text(node) !== null) selectedBlocks.push(node);
    else demoSchema.children(node).forEach((child) => include(child.id));
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
      if (range.kind === 'node' || range.to > range.from || view.collapsed || view.nonTextSelection)
        include(range.id);
    }

  const blockLabel = selectedBlockLabel(demoSchema, editorState, tree);

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
