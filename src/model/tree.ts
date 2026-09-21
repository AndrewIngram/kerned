import type { NodeIdentity, Schema } from './schema';

export type TreeEntry<N> = { node: N; parent: number | null; index: number; path: number[] };

export function indexTree<N extends NodeIdentity>(schema: Schema<N>, nodes: readonly N[]) {
  const byId = new Map<number, TreeEntry<N>>(),
    byKey = new Map<string, TreeEntry<N>>(),
    order: TreeEntry<N>[] = [];

  const pending: TreeEntry<N>[] = nodes
    .map((node, index) => ({ node, parent: null, index, path: [index] }) satisfies TreeEntry<N>)
    .toReversed();

  while (pending.length) {
    const entry = pending.pop();

    if (!entry) break;

    if (byId.has(entry.node.id) || byKey.has(entry.node.key))
      throw new Error('Duplicate or cyclic node identity');

    if (
      !entry.node.key ||
      !Number.isSafeInteger(entry.node.id) ||
      (entry.node.locked !== undefined && !entry.node.locked && entry.node.locked)
    )
      throw new Error('Invalid node identity');
    schema.resolve(entry.node);
    byId.set(entry.node.id, entry);
    byKey.set(entry.node.key, entry);
    order.push(entry);
    const children = schema.children(entry.node);

    for (let i = children.length - 1; i >= 0; i--)
      pending.push({
        node: children[i],
        parent: entry.node.id,
        index: i,
        path: [...entry.path, i],
      });
  }

  return { byId, byKey, order };
}

export type TreeIndex<N extends NodeIdentity> = ReturnType<typeof indexTree<N>>;

export function validateTree<N extends NodeIdentity>(
  schema: Schema<N>,
  nodes: readonly N[],
  tree = indexTree(schema, nodes),
) {
  for (const { node, parent } of tree.order)
    schema.validateChildren(node, parent === null ? null : (tree.byId.get(parent)?.node ?? null));

  return tree;
}

export function childrenAt<N extends NodeIdentity>(
  schema: Schema<N>,
  nodes: readonly N[],
  parent: number | null,
  tree = indexTree(schema, nodes),
): readonly N[] {
  if (parent === null) return nodes;
  const entry = tree.byId.get(parent);

  if (!entry) throw new Error('Missing container');

  if (schema.resolve(entry.node).kind !== 'container') throw new Error('Target is not a container');

  return schema.children(entry.node);
}

export function spliceChildren<N extends NodeIdentity>(
  schema: Schema<N>,
  nodes: readonly N[],
  parent: number | null,
  index: number,
  count: number,
  inserted: readonly N[],
  tree = indexTree(schema, nodes),
): N[] {
  const entry = parent === null ? undefined : tree.byId.get(parent);

  if (parent !== null && !entry) throw new Error('Missing container');

  if (entry && schema.resolve(entry.node).kind !== 'container')
    throw new Error('Target is not a container');
  const children = entry ? schema.children(entry.node) : nodes;

  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(count) ||
    index < 0 ||
    count < 0 ||
    index + count > children.length
  )
    throw new Error('Invalid child range');
  const next = [...children.slice(0, index), ...inserted, ...children.slice(index + count)];

  if (!entry) return next;
  let replacement = schema.withChildren(entry.node, next);

  for (let depth = entry.path.length - 1; depth > 0; depth--) {
    let ancestor = nodes[entry.path[0]];

    for (let i = 1; i < depth; i++) ancestor = schema.children(ancestor)[entry.path[i]];
    const siblings = [...schema.children(ancestor)];
    siblings[entry.path[depth]] = replacement;
    replacement = schema.withChildren(ancestor, siblings);
  }

  const roots = [...nodes];
  roots[entry.path[0]] = replacement;

  return roots;
}
