import {
  parseRelativeGap,
  type RelativeGap,
  type NodeIdentity,
  type Schema,
  indexTree,
  childrenAt,
} from '@gprose/model';

export type RelativeGapResult =
  | { status: 'resolved'; gap: { parent: number | null; index: number } }
  | { status: 'deleted' }
  | { status: 'unavailable'; reason: 'document-mismatch' };

export function createStructuralPositions<N extends NodeIdentity>(
  schema: Schema<N>,
  documentId: string,
  nodes: () => readonly N[],
) {
  function gap(parent: number | null, index: number, association: -1 | 1 = 1): RelativeGap {
    const current = nodes(),
      tree = indexTree(schema, current),
      children = childrenAt(schema, current, parent, tree);

    if (!Number.isSafeInteger(index) || index < 0 || index > children.length)
      throw new Error('Invalid child gap');
    const parentKey = parent === null ? null : tree.byId.get(parent)?.node.key;

    if (parentKey === undefined) throw new Error('Missing gap parent');

    return parseRelativeGap({
      version: 1,
      kind: 'gap',
      documentId,
      parentKey,
      beforeKey: children[index - 1]?.key ?? null,
      afterKey: children[index]?.key ?? null,
      association,
    });
  }

  return {
    gap,
    before(id: number): RelativeGap {
      const entry = indexTree(schema, nodes()).byId.get(id);

      if (!entry) throw new Error('Missing node');

      return gap(entry.parent, entry.index, 1);
    },
    after(id: number): RelativeGap {
      const entry = indexTree(schema, nodes()).byId.get(id);

      if (!entry) throw new Error('Missing node');

      return gap(entry.parent, entry.index + 1, -1);
    },
    resolveGap(position: RelativeGap): RelativeGapResult {
      if (position.documentId !== documentId)
        return { status: 'unavailable', reason: 'document-mismatch' };

      const current = nodes(),
        tree = indexTree(schema, current);

      // The associated edge follows its node through moves, wrapping and unwrapping.
      const preferred = position.association === 1 ? position.afterKey : position.beforeKey;
      const fallback = position.association === 1 ? position.beforeKey : position.afterKey;

      for (const [key, side] of [
        [preferred, position.association],
        [fallback, -position.association],
      ] as const) {
        const entry = key === null ? undefined : tree.byKey.get(key);

        if (entry)
          return {
            status: 'resolved',
            gap: { parent: entry.parent, index: entry.index + (side === -1 ? 1 : 0) },
          };
      }

      // Only a gap captured in an empty container is attached to the container
      // itself. Losing both nonempty edges is explicit deletion, not a guessed index.
      if (position.beforeKey !== null || position.afterKey !== null) return { status: 'deleted' };
      const parent = position.parentKey === null ? null : tree.byKey.get(position.parentKey)?.node;

      if (parent === undefined || (parent !== null && schema.resolve(parent).kind !== 'container'))
        return { status: 'deleted' };
      const children = parent === null ? current : schema.children(parent);

      return {
        status: 'resolved',
        gap: {
          parent: parent?.id ?? null,
          index: position.association === 1 ? children.length : 0,
        },
      };
    },
  };
}
