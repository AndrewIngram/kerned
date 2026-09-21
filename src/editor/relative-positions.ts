import {captureDocumentRange,resolvedDocumentRange,type RelativeEndpoint,type DocumentRange,type DocumentRangeResult} from './document-ranges';
import {mapBoundary,projectBoundaryRange,type BoundaryPoint,type RemovedBoundary,type NodeEdge} from './relative-boundaries';
import {selectionContext,type Selection} from './selection';
import type {RangeEndpoint} from './range-selection';
import {createMappingIndex,createRevisionMappingIndex,combineEffects,projectOutside,mayCoverRange} from './mapping-index';
import {invertAnchorMap, type AnchorMap} from './anchors';
import type {NodeIdentity, Schema} from './schema';
import {indexTree} from './tree';
import {boundaries, validateTextRange} from './text';
import {createStructuralPositions} from './structural-positions';

export type RelativePosition = Readonly<{version: 1; documentId: string; revision: number; key: string; offset: number; association: -1 | 1}>;

export type RelativeRange = Readonly<{version: 1; start: RelativePosition; end: RelativePosition}>;

export type RelativePositionResult = {status: 'resolved'; point: {id: number; offset: number}} | {status: 'deleted'}
  | {status: 'unavailable'; reason: 'document-mismatch' | 'future-revision' | 'history-unavailable'};

export type RelativeRangeResult = {status: 'resolved'; ranges: readonly {id: number; from: number; to: number}[]} | Exclude<RelativePositionResult, {status: 'resolved'}>;

export type MappingOperation = Readonly<{id: number; inverse: boolean}>;

type State<N> = {nodes: readonly N[]; revision: number};

type Point = {key: string; offset: number};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected position data');

  return Object.fromEntries(Object.entries(value));
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid position integer');

  return value;
}

function string(value: unknown): string {if (typeof value !== 'string' || !value) throw new Error('Invalid position identity');

 return value;}

function association(value: unknown): -1 | 1 {if (value !== -1 && value !== 1) throw new Error('Invalid association');

 return value;}

export function parseRelativePosition(value: unknown): RelativePosition {
  const data = record(value);

  if (data.version !== 1) throw new Error('Unsupported relative position version');

  return Object.freeze({version: 1, documentId: string(data.documentId), revision: integer(data.revision), key: string(data.key), offset: integer(data.offset), association: association(data.association)});
}

export function parseRelativeRange(value: unknown): RelativeRange {
  const data = record(value);

  if (data.version !== 1) throw new Error('Unsupported relative range version');
  const start = parseRelativePosition(data.start), end = parseRelativePosition(data.end);

  if (start.documentId !== end.documentId || start.revision !== end.revision) throw new Error('Range endpoints must share a document snapshot');

  return Object.freeze({version: 1, start, end});
}

function parseMap(value: unknown): AnchorMap {
  const data = record(value);

  switch (data.kind) {
    case 'replace': {
      const from = integer(data.from), to = integer(data.to);

      if (to < from) throw new Error('Invalid replacement mapping');

      return {kind: 'replace', key: string(data.key), from, to, inserted: integer(data.inserted)};
    }

    case 'split': case 'join': return {kind: data.kind, key: string(data.key), at: integer(data.at), rightKey: string(data.rightKey)};
    case 'insert': case 'remove': {
      if (!Array.isArray(data.keys)) throw new Error('Invalid identity mapping');
      const keys = data.keys.map(string);

      if (data.kind === 'insert') return {kind: 'insert', keys};

      const point = (value: unknown): Point | null => {if (value === null) return null; const p = record(value);

 return {key: string(p.key), offset: integer(p.offset)};};

      let boundaries: RemovedBoundary[] | undefined;

      if (data.boundaries !== undefined) {
        if (!Array.isArray(data.boundaries)) throw new Error('Invalid removal boundaries');

        const edge = (value: unknown): NodeEdge => {
          const p = record(value);

          if (p.side !== 'before' && p.side !== 'after') throw new Error('Invalid boundary side');

          return {key:string(p.key),side:p.side};
        };

        boundaries = data.boundaries.map(value => {
          const b = record(value), p = edge(b);

          return {...p,left:b.left === null ? null : edge(b.left),right:b.right === null ? null : edge(b.right)};
        });
      }

      if (data.fallbacks === undefined) return {kind: 'remove', keys, boundaries};

      if (!Array.isArray(data.fallbacks)) throw new Error('Invalid removal boundaries');

      return {kind: 'remove', keys, boundaries, fallbacks: data.fallbacks.map(value => {const f = record(value);

 return {key: string(f.key), before: point(f.before), after: point(f.after)};})};
    }

    default: throw new Error('Unknown position mapping');
  }
}

function mapped(point: Point | null, map: AnchorMap, bias: -1 | 1, role?: 'start' | 'end'): Point | null {
  if (!point) return null;

  if (map.kind === 'remove' && map.keys.includes(point.key)) {
    const f = map.fallbacks?.find(f => f.key === point.key);

    return (role === 'start' || !role && bias === 1) ? f?.after ?? f?.before ?? null : f?.before ?? f?.after ?? null;
  }

  if (map.kind === 'split' && point.key === map.key && (point.offset > map.at || point.offset === map.at && bias === 1)) return {key: map.rightKey, offset: point.offset - map.at};

  if (map.kind === 'join' && point.key === map.rightKey) return {key: map.key, offset: point.offset + map.at};

  if (map.kind === 'replace' && point.key === map.key) {
    const offset = point.offset;

    return {key: point.key, offset: offset < map.from ? offset : offset > map.to ? offset + map.inserted - (map.to - map.from) : map.from + (bias === 1 ? map.inserted : 0)};
  }

  return point;
}

/** Owned OT-candidate position index. Stores document change metadata, never ranges. */
export function createRelativePositions<N extends NodeIdentity>(schema: Schema<N>, initial: State<N>, documentId: string, checkpoint?: unknown) {
  let state = initial, since = initial.revision;
  const definitions = new Map<number, readonly AnchorMap[]>();
  const events: {revision: number; operations: readonly MappingOperation[]}[] = [];
  let indexed: readonly N[] | undefined, cached: ReturnType<typeof indexTree<N>> | undefined;
  let textNodes: N[] = [];
  const textRanks = new Map<number, number>(), graphemes = new WeakMap<N, readonly number[]>();
  const suffixes = new Map<number, ReturnType<typeof createMappingIndex>>();
  let suffixWeight = 0;

  type HistoryGroup = {kind: 'forward'; index: ReturnType<typeof createRevisionMappingIndex>}
    | {kind: 'restore'; revisions: readonly number[]; index: ReturnType<typeof createMappingIndex>};

  let historyGroups: HistoryGroup[] | undefined;
  const emptyIndex = createMappingIndex([]);

  function tree() {
    if (indexed !== state.nodes || !cached) {
      cached = indexTree(schema, state.nodes); indexed = state.nodes;
      textNodes = cached.order.flatMap(({node}) => schema.text(node) === null ? [] : [node]);
      textRanks.clear(); textNodes.forEach((node, i) => textRanks.set(node.id, i));
    }

    return cached;
  }

  if (checkpoint !== undefined) {
    const data = record(checkpoint);

    if (data.version !== 1 || data.documentId !== documentId || data.revision !== state.revision || !Array.isArray(data.definitions) || !Array.isArray(data.events)) throw new Error('Position checkpoint does not match document');
    since = integer(data.since);

    if (since > state.revision) throw new Error('Invalid checkpoint origin');

    for (const value of data.definitions) {
      const d = record(value), id = integer(d.id);

      if (id <= since || id > state.revision || definitions.has(id) || !Array.isArray(d.maps)) throw new Error('Invalid mapping definition');
      definitions.set(id, d.maps.map(parseMap));
    }

    let previous = since;
    const active = new Map<number, boolean>();

    for (const value of data.events) {
      const e = record(value), revision = integer(e.revision);

      if (revision <= previous || revision > state.revision || !Array.isArray(e.operations)) throw new Error('Invalid mapping event');

      const operations = e.operations.map(value => {
        const op = record(value), id = integer(op.id);

        if (!definitions.has(id) || id > revision || typeof op.inverse !== 'boolean') throw new Error('Invalid mapping operation');

        if (!active.has(id) && (id !== revision || op.inverse)) throw new Error('Missing original mapping event');

        if ((active.get(id) ?? false) !== op.inverse) throw new Error('Invalid mapping undo sequence');
        active.set(id, !op.inverse);

        return {id, inverse: op.inverse};
      });

      events.push({revision, operations}); previous = revision;
    }

    if (active.size !== definitions.size) throw new Error('Unused mapping definition');
  }

  function check(position: Pick<RelativePosition,'documentId'|'revision'>): Exclude<RelativePositionResult, {status: 'resolved'}> | null {
    if (position.documentId !== documentId) return {status: 'unavailable', reason: 'document-mismatch'};

    if (position.revision > state.revision) return {status: 'unavailable', reason: 'future-revision'};

    if (position.revision < since) return {status: 'unavailable', reason: 'history-unavailable'};

    return null;
  }

  function replayAfter(revision: number): ReturnType<typeof createMappingIndex> {
    const cached = suffixes.get(revision);

 if (cached) return cached;
    // Cancel an operation and its undo only when both are after the captured
    // position. This restores exact old coordinates without remembering ranges.
    const pending: (MappingOperation | null)[] = [], last = new Map<number, number>();

    for (const event of events) if (event.revision > revision) for (const op of event.operations) {
      const index = last.get(op.id), prior = index === undefined ? undefined : pending[index];

      if (prior && prior.inverse !== op.inverse && index !== undefined) {pending[index] = null; last.delete(op.id);}
      else {last.set(op.id, pending.length); pending.push(op);}
    }

    const result = pending.flatMap(op => {
      if (!op) return [];
      const maps = definitions.get(op.id);

      if (!maps) throw new Error('Missing position mapping');

      return op.inverse ? [...maps].reverse().map(invertAnchorMap) : [...maps];
    });

    const index = createMappingIndex(result);

    while (suffixes.size && (suffixes.size >= 32 || suffixWeight + index.weight > 100_000)) {
      const oldest = suffixes.keys().next().value;

      if (oldest === undefined) break;
      suffixWeight -= suffixes.get(oldest)?.weight ?? 0; suffixes.delete(oldest);
    }

    suffixes.set(revision, index); suffixWeight += index.weight;

 return index;
  }

  function changesAfter(revision: number) {
    if (revision === state.revision) return emptyIndex;

    if (!historyGroups) {
      const occurrences = new Map<number, {revision: number; op: MappingOperation}[]>();

      for (const event of events) for (const op of event.operations) {
        let list = occurrences.get(op.id);

 if (!list) {list = []; occurrences.set(op.id, list);}

        list.push({revision: event.revision, op});
      }

      const groups: HistoryGroup[] = []; historyGroups = groups;
      let forward: {revision: number; maps: readonly AnchorMap[]}[] = [];

      const flush = () => {
        if (forward.length) groups.push({kind: 'forward', index: createRevisionMappingIndex(forward)});
        forward = [];
      };

      // Cancellation leaves the last occurrence iff the suffix contains an odd
      // number of toggles. Shared forward segments exclude restored operations.
      for (const event of events) for (const op of event.operations) {
        const list = occurrences.get(op.id), maps = definitions.get(op.id);

        if (!list || !maps) throw new Error('Missing position mapping');

        if (list.at(-1)?.op !== op) continue;

        if (list.length === 1) forward.push({revision: event.revision, maps});
        else {
          flush();
          groups.push({kind: 'restore', revisions: list.map(entry => entry.revision),
            index: createMappingIndex(op.inverse ? [...maps].reverse().map(invertAnchorMap) : maps)});
        }
      }

      flush();
    }

    const effects = historyGroups.flatMap(group => {
      if (group.kind === 'forward') return [group.index.at(revision)];
      let low = 0, high = group.revisions.length;

      while (low < high) {const mid = (low + high) >>> 1;

 if (group.revisions[mid] <= revision) low = mid + 1; else high = mid;}

      return (group.revisions.length - low) % 2 ? [group.index.effects] : [];
    });

    return {effects: {get(key: string) {
      let result: ReturnType<typeof combineEffects>;

      for (const effect of effects) result = combineEffects(result, effect.get(key));

      return result;
    }}, chunks: () => replayAfter(revision).chunks()};
  }

  function resolvePoint(point: Point | null, bias: -1 | 1): RelativePositionResult {
    if (!point) return {status: 'deleted'};
    const node = tree().byKey.get(point.key)?.node, text = node ? schema.text(node) : null;

    if (!node || text === null) return {status: 'deleted'};

    if (point.offset < 0 || point.offset > text.length) throw new Error('Position metadata does not match document');
    let stops = graphemes.get(node);

 if (!stops) {stops = boundaries(text); graphemes.set(node, stops);}

    let low = 0, high = stops.length;

    while (low < high) {const mid = (low + high) >>> 1;

 if (stops[mid] < point.offset) low = mid + 1; else high = mid;}

    const offset = stops[low] === point.offset || bias === 1 ? stops[low] : stops[low - 1];

    if (offset === undefined) throw new Error('Invalid mapped position');

    return {status: 'resolved', point: {id: node.id, offset}};
  }

  function resolve(position: RelativePosition): RelativePositionResult {
    const error = check(position);

 if (error) return error;
    let point: Point | null = {key: position.key, offset: position.offset};
    const index = changesAfter(position.revision), fast = projectOutside(index.effects, point, position.association);

    if (fast !== false) point = fast;
    else for (const chunk of index.chunks()) {
      const fast = projectOutside(chunk.effects, point, position.association);

      if (fast !== false) point = fast;
      else for (const map of chunk.maps) point = mapped(point, map, position.association);
    }

    return resolvePoint(point, position.association);
  }

  let rangeContext: ReturnType<typeof selectionContext<N>> | undefined,
    rangeNodes: readonly N[] | undefined;

  function context() {
    if (rangeNodes !== state.nodes || !rangeContext) {
      rangeNodes = state.nodes;
      rangeContext = selectionContext(schema, [...state.nodes], tree());
    }

    return rangeContext;
  }

  function endpoint(point: RangeEndpoint, bias: -1 | 1): RelativeEndpoint {
    if (point.kind === 'text') return api.at(point.id, point.offset, bias);
    const node = tree().byId.get(point.id)?.node;

    if (!node) throw new Error('Missing boundary node');

    return Object.freeze({
      version: 1,
      documentId,
      revision: state.revision,
      key: node.key,
      side: point.side,
      association: bias,
    });
  }

  function snapshotBoundary(point: BoundaryPoint | null, bias: -1 | 1): RangeEndpoint | null {
    if (!point) return null;

    if ('side' in point) {
      const node = tree().byKey.get(point.key)?.node;

      return node ? { kind: 'node', id: node.id, side: point.side } : null;
    }

    const result = resolvePoint(point, bias);

    return result.status === 'resolved' ? { kind: 'text', ...result.point } : null;
  }

  function resolveDocumentRange(range: DocumentRange): DocumentRangeResult {
    const error = check(range.start) ?? check(range.end);

    if (error) return error;

    if (range.start.revision !== range.end.revision)
      throw new Error('Range endpoints must share a revision');

    let start: BoundaryPoint | null = range.start,
      end: BoundaryPoint | null = range.end;

    const index = changesAfter(range.start.revision);

    // Skip safe history at both the revision and chunk levels, as text ranges do.
    const fast = projectBoundaryRange(
      index.effects,
      start,
      end,
      range.start.association,
      range.end.association,
    );

    if (fast !== false) {
      start = fast.start;
      end = fast.end;
    } else
      for (const chunk of index.chunks()) {
        const fast = projectBoundaryRange(
          chunk.effects,
          start,
          end,
          range.start.association,
          range.end.association,
        );

        if (fast !== false) {
          start = fast.start;
          end = fast.end;
          continue;
        }

        for (const map of chunk.maps) {
          if (
            start &&
            end &&
            !('side' in start) &&
            !('side' in end) &&
            start.key === end.key &&
            map.kind === 'replace' &&
            map.key === start.key &&
            map.to > map.from &&
            map.from <= start.offset &&
            map.to >= end.offset
          )
            return { status: 'deleted' };
          start = mapBoundary(start, map, range.start.association, 'start');
          end = mapBoundary(end, map, range.end.association, 'end');
        }
      }

    const a = snapshotBoundary(start, range.start.association),
      b = snapshotBoundary(end, range.end.association);

    return a && b ? resolvedDocumentRange(context(), a, b) : { status: 'deleted' };
  }

  const api = Object.freeze({
    ...createStructuralPositions(schema,documentId,()=>state.nodes),
    captureRange(selection: Selection): DocumentRange | null {return captureDocumentRange(selection,context(),endpoint);},
    resolveDocumentRange,
    at(id: number, offset: number, bias: -1 | 1 = 1): RelativePosition {
      association(bias);
      const node = tree().byId.get(id)?.node, text = node ? schema.text(node) : null;

      if (!node || text === null) throw new Error('Relative position requires text');
      validateTextRange(text, offset, offset);

      return Object.freeze({version: 1, documentId, revision: state.revision, key: node.key, offset, association: bias});
    },
    range(start: RelativePosition, end: RelativePosition): RelativeRange {
      const result = parseRelativeRange({version: 1, start, end});
      const a = resolve(start), b = resolve(end);

      if (a.status !== 'resolved' || b.status !== 'resolved') throw new Error('Cannot create an unresolved range');
      tree(); const first = textRanks.get(a.point.id), last = textRanks.get(b.point.id);

      if (first === undefined || last === undefined) throw new Error('Missing range endpoint');

      if (first > last || first === last && a.point.offset > b.point.offset) throw new Error('Range endpoints are reversed');

      return result;
    },
    resolve,
    resolveRange(range: RelativeRange): RelativeRangeResult {
      const error = check(range.start) ?? check(range.end);

 if (error) return error;

      if (range.start.revision !== range.end.revision) throw new Error('Range endpoints must share a revision');
      let start: Point | null = {key: range.start.key, offset: range.start.offset}, end: Point | null = {key: range.end.key, offset: range.end.offset};
      const originallyEmpty = start.key === end.key && start.offset === end.offset;
      const index = changesAfter(range.start.revision);
      const fastStart = projectOutside(index.effects, start, range.start.association), fastEnd = projectOutside(index.effects, end, range.end.association);

      if (fastStart !== false && fastEnd !== false && (originallyEmpty || !mayCoverRange(index.effects, start, end))) {start = fastStart; end = fastEnd;}
      else for (const chunk of index.chunks()) {
        const fastStart = projectOutside(chunk.effects, start, range.start.association), fastEnd = projectOutside(chunk.effects, end, range.end.association);

        if (fastStart !== false && fastEnd !== false && (originallyEmpty || !mayCoverRange(chunk.effects, start, end))) {start = fastStart; end = fastEnd; continue;}

        for (const map of chunk.maps) {
          if (!originallyEmpty && start && end && start.key === end.key && map.kind === 'replace' && map.key === start.key && map.to > map.from && map.from <= start.offset && map.to >= end.offset) return {status: 'deleted'};
          start = mapped(start, map, range.start.association, 'start'); end = mapped(end, map, range.end.association, 'end');
        }
      }

      const a = resolvePoint(start, range.start.association), b = resolvePoint(end, range.end.association);

      if (a.status !== 'resolved') return a;

 if (b.status !== 'resolved') return b;
      tree(); const first = textRanks.get(a.point.id), last = textRanks.get(b.point.id);

      if (first === undefined || last === undefined) return {status: 'deleted'};

      if (first > last || first === last && (a.point.offset > b.point.offset || !originallyEmpty && a.point.offset === b.point.offset)) return {status: 'deleted'};

      return {status: 'resolved', ranges: textNodes.slice(first, last + 1).map(node => ({id: node.id, from: node.id === a.point.id ? a.point.offset : 0, to: node.id === b.point.id ? b.point.offset : schema.text(node)?.length ?? 0}))};
    },
    checkpoint() {
      return {version: 1, documentId, revision: state.revision, since,
        definitions: [...definitions].map(([id, maps]) => ({id, maps: structuredClone(maps)})),
        events: events.map(event => ({revision: event.revision, operations: event.operations.map(op => ({...op}))}))};
    },
  });

  return {api, advance(next: State<N>, maps: readonly AnchorMap[], restore?: {operations: readonly MappingOperation[]; redo: boolean}): readonly MappingOperation[] {
    if (next.revision !== state.revision + 1) throw new Error('Position index requires consecutive revisions');

    const operations: readonly MappingOperation[] = restore ? (restore.redo ? restore.operations : [...restore.operations].reverse().map(op => ({id: op.id, inverse: !op.inverse})))
      : maps.length ? [{id: next.revision, inverse: false}] : [];

    if (!restore && maps.length) definitions.set(next.revision, maps.map(map => map.kind === 'remove' ? {...map, keys: [...map.keys], boundaries:map.boundaries?.map(b=>({...b,left:b.left&&{...b.left},right:b.right&&{...b.right}})), fallbacks: map.fallbacks?.map(f => ({key: f.key, before: f.before && {...f.before}, after: f.after && {...f.after}}))} : map.kind === 'insert' ? {...map, keys: [...map.keys]} : {...map}));

    if (operations.length) events.push({revision: next.revision, operations: operations.map(op => ({...op}))});
    state = next; suffixes.clear(); suffixWeight = 0; historyGroups = undefined;

    return operations;
  }};
}
