import type { NodeIdentity, Schema } from '../model';

export type OutlineHeading = { level: number; title: string };

export type OutlineEntry = Readonly<
  NodeIdentity & OutlineHeading & { depth: number; parentKey: string | null }
>;

/** Derived document data, independent of React, layout and any heading schema.
 * Nodes must be immutable, as they are in editor transactions. Unchanged
 * subtrees retain their extracted headings; scrolling never calls the adapter.
 */
export function createOutlineExtension<N extends NodeIdentity>(
  schema: Schema<N>,
  heading: (node: N) => OutlineHeading | null,
) {
  const cache = new WeakMap<N, readonly (NodeIdentity & OutlineHeading)[]>();
  const empty: readonly OutlineEntry[] = [];

  let previous: readonly N[] | undefined,
    previousPending: readonly OutlineEntry[] | undefined,
    result: readonly OutlineEntry[] = [];

  function collect(node: N): readonly (NodeIdentity & OutlineHeading)[] {
    const cached = cache.get(node);

    if (cached) return cached;
    const value = heading(node);

    if (value && (!Number.isSafeInteger(value.level) || value.level < 1))
      throw new Error('Outline levels must be positive integers');

    const entries: (NodeIdentity & OutlineHeading)[] = value
      ? [{ id: node.id, key: node.key, level: value.level, title: value.title }]
      : [];

    for (const child of schema.children(node)) entries.push(...collect(child));
    cache.set(node, entries);

    return entries;
  }

  return {
    read(nodes: readonly N[], pending: readonly OutlineEntry[] = empty): readonly OutlineEntry[] {
      if (nodes === previous && pending === previousPending) return result;

      const next: OutlineEntry[] = [],
        ancestors: OutlineEntry[] = [];

      const headings = nodes.flatMap((node) => collect(node));

      for (const entry of [...headings, ...pending]) {
        while (ancestors.length && ancestors[ancestors.length - 1].level >= entry.level)
          ancestors.pop();

        const item = {
          ...entry,
          depth: ancestors.length,
          parentKey: ancestors.at(-1)?.key ?? null,
        };

        next.push(item);
        ancestors.push(item);
      }

      previous = nodes;
      previousPending = pending;
      result = next;

      return result;
    },
  };
}
