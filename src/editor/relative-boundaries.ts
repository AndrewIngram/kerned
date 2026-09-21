import { projectOutside, mayCoverRange } from './mapping-index';
import type { AnchorMap } from './anchors';
import type { NodeIdentity, Schema } from './schema';
import type { TreeIndex } from './tree';

export type NodeEdge = { key: string; side: 'before' | 'after' };

export type BoundaryPoint = NodeEdge | { key: string; offset: number };

export type RemovedBoundary = NodeEdge & { left: NodeEdge | null; right: NodeEdge | null };

/** Surviving edges around removed boundaries, including children of unwrapped containers. */
export function removalBoundaries<N extends NodeIdentity>(
  schema: Schema<N>,
  before: TreeIndex<N>,
  after: TreeIndex<N>,
): RemovedBoundary[] {
  const edges: NodeEdge[] = [];

  function visit(node: N) {
    edges.push({ key: node.key, side: 'before' });

    for (const child of schema.children(node)) visit(child);
    edges.push({ key: node.key, side: 'after' });
  }

  for (const entry of before.order) if (entry.parent === null) visit(entry.node);
  const removed: RemovedBoundary[] = [];
  let left: NodeEdge | null = null;

  for (const edge of edges) {
    if (after.byKey.has(edge.key)) left = edge;
    else removed.push({ ...edge, left, right: null });
  }

  let right: NodeEdge | null = null,
    cursor = removed.length - 1;

  for (let i = edges.length - 1; i >= 0; i--) {
    const edge = edges[i];

    if (after.byKey.has(edge.key)) right = edge;
    else removed[cursor--].right = right;
  }

  return removed;
}

/** Range boundaries shrink inward when their content is removed. */
export function mapBoundary(
  point: BoundaryPoint | null,
  map: AnchorMap,
  association: -1 | 1,
  role: 'start' | 'end',
): BoundaryPoint | null {
  if (!point) return null;

  if (map.kind === 'remove' && map.keys.includes(point.key)) {
    const side = 'side' in point ? point.side : role === 'start' ? 'before' : 'after';
    const edge = map.boundaries?.find((entry) => entry.key === point.key && entry.side === side);

    if (edge) return role === 'start' ? edge.right : edge.left;
    // Older text-only checkpoints can still resolve their text boundaries.
    const text = map.fallbacks?.find((entry) => entry.key === point.key);

    return role === 'start' ? (text?.after ?? null) : (text?.before ?? null);
  }

  if ('side' in point) {
    if (map.kind === 'split' && point.key === map.key && point.side === 'after')
      return { ...point, key: map.rightKey };

    if (map.kind === 'join') {
      if (point.key === map.rightKey)
        return point.side === 'before'
          ? { key: map.key, offset: map.at }
          : { ...point, key: map.key };

      if (point.key === map.key && point.side === 'after') return { key: map.key, offset: map.at };
    }

    return point;
  }

  if (
    map.kind === 'split' &&
    point.key === map.key &&
    (point.offset > map.at || (point.offset === map.at && association === 1))
  )
    return { key: map.rightKey, offset: point.offset - map.at };

  if (map.kind === 'join' && point.key === map.rightKey)
    return { key: map.key, offset: point.offset + map.at };

  if (map.kind === 'replace' && point.key === map.key) {
    const offset = point.offset;

    return {
      key: point.key,
      offset:
        offset < map.from
          ? offset
          : offset > map.to
            ? offset + map.inserted - (map.to - map.from)
            : map.from + (association === 1 ? map.inserted : 0),
    };
  }

  return point;
}

/** Share the text index shortcuts without skipping a range's complete replacement. */
export function projectBoundaryRange(
  effects: Parameters<typeof projectOutside>[0],
  start: BoundaryPoint | null,
  end: BoundaryPoint | null,
  startBias: -1 | 1,
  endBias: -1 | 1,
): { start: BoundaryPoint | null; end: BoundaryPoint | null } | false {
  function project(point: BoundaryPoint | null, bias: -1 | 1) {
    return point && 'side' in point
      ? effects.get(point.key)?.kind === 'structural'
        ? false
        : point
      : projectOutside(effects, point, bias);
  }

  const first = project(start, startBias),
    last = project(end, endBias);

  if (first === false || last === false) return false;

  if (start && end && !('side' in start) && !('side' in end) && mayCoverRange(effects, start, end))
    return false;

  return { start: first, end: last };
}
