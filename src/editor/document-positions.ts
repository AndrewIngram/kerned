import type {NodeIdentity, Schema} from './schema';
import {indexTree} from './tree';
import {boundaries} from './text';
import {mapPosition,mapGapPosition, type PositionMap} from './positions';

const positionBrand: unique symbol = Symbol('snapshot position');
const mappedLocation: unique symbol = Symbol('mapped location');
const snapshotState: unique symbol = Symbol('snapshot state');
type DocumentSnapshot<N> = {nodes: readonly N[]; revision: number};
export type SnapshotTransition<N> = Readonly<{before: DocumentSnapshot<N>; after: DocumentSnapshot<N>; maps: readonly PositionMap[]}>;
type Location = {kind: 'text'; id: number; offset: number} | {kind: 'gap'; parent: number | null; index: number};
/** Query coordinates, valid only in the snapshot that created them. Not a persistence format. */
export type SnapshotPosition = Readonly<Location & {[positionBrand]: true}>;
export type SnapshotRange = Readonly<{from: SnapshotPosition; to: SnapshotPosition; backward: boolean}>;
export type MappedSnapshotPosition = {status: 'mapped'; position: SnapshotPosition} | {status: 'deleted'};
export type ResolvedPosition<N> = Readonly<{
  position: SnapshotPosition;
  /** Root-to-target chain, including the text node or gap's container. Root gaps have no ancestors. */
  ancestors: readonly N[];
  node: N | null;
}>;

/**
 * Build once for an immutable document snapshot, then reuse for position queries.
 * Reuses the tree index's ancestor paths; resolution is O(depth). Text boundaries are
 * segmented once per queried text node. No layout or durable-anchor work occurs here.
 */
export function createPositionSnapshot<N extends NodeIdentity>(schema: Schema<N>, state: {nodes: readonly N[]; revision: number}): PositionSnapshot<N> {
  const tree = indexTree(schema, state.nodes);
  const sizes = new Map<number, number>(), starts = new Map<number, number>();
  const gaps = new Map<number | null, readonly number[]>();
  const textStops = new Map<number, ReadonlySet<number>>();
  const positions = new WeakMap<SnapshotPosition, {rank: number; node: N | null}>();

  // Text and container nodes occupy opening/closing tokens; atoms occupy one.
  // These ranks support comparison without flattening the document's text.
  for (let i = tree.order.length - 1; i >= 0; i--) {
    const node = tree.order[i].node, type = schema.resolve(node);
    const size = type.kind === 'text' ? type.editing.text(node).length + 2
      : type.kind === 'atom' ? 1
      : type.content.children(node).reduce((total, child) => total + sizeOf(child.id), 2);
    sizes.set(node.id, size);
  }
  function sizeOf(id: number): number {
    const size = sizes.get(id);
    if (size === undefined) throw new Error('Missing indexed node size');
    return size;
  }
  function indexChildren(parent: number | null, children: readonly N[], start: number) {
    const ranks = [start];
    for (const child of children) {
      starts.set(child.id, start);
      start += sizeOf(child.id);
      ranks.push(start);
    }
    gaps.set(parent, ranks);
  }
  indexChildren(null, state.nodes, 0);
  for (const {node} of tree.order) {
    if (schema.resolve(node).kind === 'container') indexChildren(node.id, schema.children(node), startOf(node.id) + 1);
  }
  function startOf(id: number): number {
    const start = starts.get(id);
    if (start === undefined) throw new Error('Missing indexed node start');
    return start;
  }
  function entry(id: number) {
    const found = tree.byId.get(id);
    if (!found) throw new Error('Position target does not exist');
    return found;
  }
  function make(location: Location, rank: number, node: N | null): SnapshotPosition {
    const point = Object.freeze<SnapshotPosition>({...location, [positionBrand]: true});
    positions.set(point, {rank, node});
    return point;
  }
  function requirePosition(point: SnapshotPosition) {
    const value = positions.get(point);
    if (!value) throw new Error('Position belongs to a different snapshot; resolve or map it first');
    return value;
  }
  function ancestors(node: N | null): readonly N[] {
    const result: N[] = [];
    for (let current = node; current;) {
      result.push(current);
      const parent = entry(current.id).parent;
      current = parent === null ? null : entry(parent).node;
    }
    return Object.freeze(result.reverse());
  }
  function gap(parent: number | null, index: number): SnapshotPosition {
    const ranks = gaps.get(parent);
    if (!ranks) throw new Error('Gap target must be a container or the document root');
    if (!Number.isSafeInteger(index) || index < 0 || index >= ranks.length) throw new Error('Invalid child gap');
    return make({kind: 'gap', parent, index}, ranks[index], parent === null ? null : entry(parent).node);
  }
  function compare(a: SnapshotPosition, b: SnapshotPosition): -1 | 0 | 1 {
    const left = requirePosition(a).rank, right = requirePosition(b).rank;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return Object.freeze({
    revision: state.revision,
    [snapshotState]: state,
    text(id: number, offset: number): SnapshotPosition {
      const node = entry(id).node, value = schema.text(node);
      if (value === null) throw new Error('Text position requires a text node');
      let stops = textStops.get(id);
      if (!stops) { stops = new Set(boundaries(value)); textStops.set(id, stops); }
      if (!Number.isSafeInteger(offset) || !stops.has(offset)) throw new Error('Text position must follow grapheme boundaries');
      return make({kind: 'text', id, offset}, startOf(id) + 1 + offset, node);
    },
    gap,
    before(id: number): SnapshotPosition { const target = entry(id); return gap(target.parent, target.index); },
    after(id: number): SnapshotPosition { const target = entry(id); return gap(target.parent, target.index + 1); },
    resolve(position: SnapshotPosition): ResolvedPosition<N> {
      const {node} = requirePosition(position);
      return Object.freeze({position, node, ancestors: ancestors(node)});
    },
    compare,
    /** Maps through one forward transaction. Missing targets stay explicitly deleted. */
    mapTo(target: PositionSnapshot<N>, point: SnapshotPosition, transition: SnapshotTransition<N>, bias: -1 | 1 = 1): MappedSnapshotPosition {
      requirePosition(point);
      if (target.revision !== state.revision + 1 || transition.before.nodes !== state.nodes || transition.before.revision !== state.revision
        || transition.after.nodes !== target[snapshotState].nodes || transition.after.revision !== target.revision) throw new Error('Mapping does not connect these snapshots');
      let location: Location = point;
      for (const map of transition.maps) {
        if (location.kind === 'text') {
          const mapped = mapPosition(location.id, location.offset, bias, map);
          location = {kind: 'text', id: mapped.id, offset: mapped.index};
        } else location={kind:'gap',...mapGapPosition(location,bias,map)};
      }
      return target[mappedLocation](location, bias);
    },
    /** Internal mapping boundary: coordinates may need grapheme normalization after an edit. */
    [mappedLocation](location: Location, bias: -1 | 1): MappedSnapshotPosition {
      if (location.kind === 'gap') {
        if (!gaps.has(location.parent)) return {status: 'deleted'};
        return {status: 'mapped', position: gap(location.parent, location.index)};
      }
      const node = tree.byId.get(location.id)?.node, value = node ? schema.text(node) : null;
      if (!node || value === null) return {status: 'deleted'};
      const stops = boundaries(value);
      const offset = bias === 1 ? stops.find(at => at >= location.offset) : stops.reverse().find(at => at <= location.offset);
      if (offset === undefined) throw new Error('Mapping produced an invalid text offset');
      return {status: 'mapped', position: make({kind: 'text', id: location.id, offset}, startOf(location.id) + 1 + offset, node)};
    },
    range(anchor: SnapshotPosition, head: SnapshotPosition): SnapshotRange {
      const backward = compare(anchor, head) > 0;
      return Object.freeze({from: backward ? head : anchor, to: backward ? anchor : head, backward});
    },
    commonAncestor(a: SnapshotPosition, b: SnapshotPosition): N | null {
      const left = ancestors(requirePosition(a).node), right = ancestors(requirePosition(b).node);
      let common: N | null = null;
      for (let i = 0; i < Math.min(left.length, right.length) && left[i].id === right[i].id; i++) common = left[i];
      return common;
    },
  });
}
export type PositionSnapshot<N extends NodeIdentity> = Readonly<{
  revision: number;
  text(id: number, offset: number): SnapshotPosition;
  gap(parent: number | null, index: number): SnapshotPosition;
  before(id: number): SnapshotPosition;
  after(id: number): SnapshotPosition;
  resolve(position: SnapshotPosition): ResolvedPosition<N>;
  compare(a: SnapshotPosition, b: SnapshotPosition): -1 | 0 | 1;
  range(anchor: SnapshotPosition, head: SnapshotPosition): SnapshotRange;
  commonAncestor(a: SnapshotPosition, b: SnapshotPosition): N | null;
  mapTo(target: PositionSnapshot<N>, point: SnapshotPosition, transition: SnapshotTransition<N>, bias?: -1 | 1): MappedSnapshotPosition;
  [snapshotState]: DocumentSnapshot<N>;
  [mappedLocation](location: Location, bias: -1 | 1): MappedSnapshotPosition;
}>;
