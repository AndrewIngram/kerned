import { indexTree, type Schema, type NodeIdentity } from '../model';
import { selectionContext, selectionView, type EditorState } from '../state';

type ProjectionPolicy<N, Block extends N, Context> = {
  initial: Context;
  isBlock(this: void, node: N): node is Block;
  child(this: void, parent: N, index: number, context: Context): Context;
};

/** A node's half-open interval in the rendered block sequence, not an editing position. */
export type ProjectedSpan<N> = Readonly<{ node: N; from: number; to: number }>;

/** One view projection owns its snapshot caches; discarded drafts can be collected. */
export function createDocumentQuery<N extends NodeIdentity, Block extends N, Context>(
  schema: Schema<N>,
  policy: ProjectionPolicy<N, Block, Context>,
) {
  const contents = new WeakMap<readonly N[], ReturnType<typeof content>>();

  function content(roots: readonly N[]) {
    const nodes: Block[] = [];
    const decorations = new Map<number, Context>();
    const containers = new Map<number, ProjectedSpan<N>>();
    const flowEvents: { kind: 'open' | 'close'; at: number; node: N }[] = [];

    function visit(node: N, inherited: Context) {
      decorations.set(node.id, inherited);

      if (policy.isBlock(node)) {
        nodes.push(node);
      } else {
        const span = { node, from: nodes.length, to: nodes.length };
        containers.set(node.id, span);
        flowEvents.push({ kind: 'open', at: nodes.length, node });
        schema
          .children(node)
          .forEach((child, index) => visit(child, policy.child(node, index, inherited)));
        span.to = nodes.length;
        flowEvents.push({ kind: 'close', at: nodes.length, node });
      }
    }

    roots.forEach((node) => visit(node, policy.initial));
    const projection = { nodes, decorations, flowEvents };
    const tree = indexTree(schema, roots);
    const context = selectionContext(schema, roots, tree);
    const nodeIndexes = new Map(projection.nodes.map((node, index) => [node.id, index]));

    /** An atomic rendered container owns the geometry of all its descendants. */
    function blockFor(id: number): Block | undefined {
      let entry = tree.byId.get(id);

      while (entry) {
        const index = nodeIndexes.get(entry.node.id);

        if (index !== undefined) return nodes[index];
        entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
      }

      return undefined;
    }

    /** Flowing containers span their descendants; native descendants resolve to their owner. */
    function spanFor(id: number): ProjectedSpan<N> | undefined {
      const container = containers.get(id);

      if (container) return container;
      const owner = blockFor(id);
      const index = owner && nodeIndexes.get(owner.id);

      return owner && index !== undefined ? { node: owner, from: index, to: index + 1 } : undefined;
    }

    return { projection, tree, context, nodeIndexes, blockFor, spanFor };
  }

  function projectState(editorState: EditorState<N>) {
    let current = contents.get(editorState.nodes);

    if (!current) {
      current = content(editorState.nodes);
      contents.set(editorState.nodes, current);
    }

    const { projection, tree, context, nodeIndexes } = current;
    const { nodes } = projection;
    const view = selectionView(schema, editorState.selection, context, nodeIndexes);
    const active = view.focusId === null ? undefined : tree.byId.get(view.focusId)?.node;
    const selectedBlocks: N[] = [];
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
      blockFor: current.blockFor,
      spanFor: current.spanFor,
    };
  }

  // Toolbar queries often ask about every selected block. Cache the selection
  // projection as well as the tree so repeated queries stay linear in selection size.
  const snapshots = new WeakMap<EditorState<N>, ReturnType<typeof projectState>>();

  return (state: EditorState<N>) => {
    let snapshot = snapshots.get(state);

    if (!snapshot) {
      snapshot = projectState(state);
      snapshots.set(state, snapshot);
    }

    return snapshot;
  };
}
