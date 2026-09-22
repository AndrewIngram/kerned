import { type NodeIdentity, type SelectionRange, validateTextRange } from '@gprose/model';
import { mapPosition, mapGapPosition, type PositionMap } from '@gprose/transform';

import { Selection } from './selection-base.js';
import {
  TextSelection,
  NodeSelection,
  textSelection,
  selectionNear,
  type SelectionContext,
  type SelectionBookmark,
  type SelectionMapping,
  type SelectionJSON,
  type SelectionEdit,
  type SelectionStep,
} from './selection.js';

/** A snapshot endpoint: either within text or immediately outside a node. */
export type RangeEndpoint =
  | { kind: 'text'; id: number; offset: number }
  | { kind: 'node'; id: number; side: 'before' | 'after' };

const endpointIndexes = new WeakMap<
  SelectionContext,
  Map<number, { before: number; after: number }>
>();

function endpointIndex(context: SelectionContext) {
  const cached = endpointIndexes.get(context);

  if (cached) return cached;
  const result = new Map<number, { before: number; after: number }>();
  let cursor = 0;

  function visit(node: NodeIdentity) {
    const before = cursor++,
      text = context.text(node.id);

    if (text !== null) cursor += text.length;
    else for (const child of context.children(node.id)) visit(child);
    result.set(node.id, { before, after: ++cursor });
  }

  for (const node of context.children(null)) visit(node);
  endpointIndexes.set(context, result);

  return result;
}

export function endpointOffset(context: SelectionContext, point: RangeEndpoint) {
  const entry = endpointIndex(context).get(point.id);

  if (!entry) throw new Error('Missing range endpoint node');

  if (point.kind === 'text') {
    validateTextRange(context.text(point.id) ?? '', point.offset, point.offset);

    if (context.text(point.id) === null) throw new Error('Expected text endpoint');

    return entry.before + 1 + point.offset;
  }

  return point.side === 'before' ? entry.before : entry.after;
}

export function rangeSelection(
  anchor: RangeEndpoint,
  head: RangeEndpoint,
  upstream = false,
): Selection {
  return anchor.kind === 'text' && head.kind === 'text'
    ? new TextSelection(anchor, head, upstream)
    : new RangeSelection(anchor, head, upstream);
}

export type SelectionAnchor = RangeEndpoint | { kind: 'node-selection'; id: number };

export function selectionAnchor(selection: Selection): SelectionAnchor | null {
  if (selection instanceof TextSelection) return { kind: 'text', ...selection.anchor };

  if (selection instanceof RangeSelection) return selection.anchor;

  if (selection instanceof NodeSelection) return { kind: 'node-selection', id: selection.id };

  return null;
}

/** Extend over the entirety of a hit node, in either document direction. */
export function extendSelection(
  anchor: SelectionAnchor,
  head: SelectionAnchor,
  context: SelectionContext,
  upstream = false,
): Selection {
  if (anchor.kind === 'node-selection' && head.kind === 'node-selection' && anchor.id === head.id)
    return new NodeSelection(anchor.id);

  const a: RangeEndpoint =
    anchor.kind === 'node-selection' ? { kind: 'node', id: anchor.id, side: 'before' } : anchor;

  const h: RangeEndpoint =
    head.kind === 'node-selection' ? { kind: 'node', id: head.id, side: 'before' } : head;

  const back = endpointOffset(context, h) < endpointOffset(context, a);

  return rangeSelection(
    anchor.kind === 'node-selection'
      ? { kind: 'node', id: anchor.id, side: back ? 'after' : 'before' }
      : anchor,
    head.kind === 'node-selection'
      ? { kind: 'node', id: head.id, side: back ? 'before' : 'after' }
      : head,
    upstream,
  );
}

/** Contiguous document selection with structural endpoints. Cell selections
 * remain a distinct extension because their ranges need not be contiguous. */
export class RangeSelection extends Selection {
  readonly type = 'range';
  constructor(
    readonly anchor: RangeEndpoint,
    readonly head: RangeEndpoint,
    readonly upstream = false,
  ) {
    super();
  }
  eq(other: Selection) {
    return (
      other instanceof RangeSelection &&
      sameEndpoint(this.anchor, other.anchor) &&
      sameEndpoint(this.head, other.head) &&
      this.upstream === other.upstream
    );
  }
  validate(context: SelectionContext) {
    endpointOffset(context, this.anchor);
    endpointOffset(context, this.head);
  }
  override isEmpty(context: SelectionContext) {
    return endpointOffset(context, this.anchor) === endpointOffset(context, this.head);
  }
  ranges(context: SelectionContext): SelectionRange[] {
    const a = endpointOffset(context, this.anchor),
      h = endpointOffset(context, this.head),
      from = Math.min(a, h),
      to = Math.max(a, h),
      index = endpointIndex(context),
      result: SelectionRange[] = [];

    function visit(node: NodeIdentity) {
      const entry = index.get(node.id)!;

      if (entry.after <= from || entry.before >= to) return;

      if (from <= entry.before && entry.after <= to) {
        result.push({ kind: 'node', id: node.id });

        return;
      }

      const text = context.text(node.id);

      if (text !== null) {
        const start = Math.max(0, from - entry.before - 1),
          end = Math.min(text.length, to - entry.before - 1);

        if (end >= start) result.push({ kind: 'text', id: node.id, from: start, to: end });
      } else {
        const children = context.children(node.id),
          start = result.length;

        for (const child of children) visit(child);

        if (
          children.length &&
          result.length - start === children.length &&
          children.every(
            (child, i) => result[start + i]?.kind === 'node' && result[start + i]?.id === child.id,
          )
        )
          result.splice(start, children.length, { kind: 'node', id: node.id });
      }
    }

    if (from !== to) for (const node of context.children(null)) visit(node);

    return result;
  }
  getBookmark(): SelectionBookmark {
    return new RangeBookmark(this.anchor, this.head, this.upstream);
  }
  encode(context: SelectionContext): SelectionJSON {
    this.validate(context);

    type EncodedEndpoint =
      | { kind: 'text'; key: string; offset: number }
      | { kind: 'node'; key: string; side: 'before' | 'after' };

    const write = (point: RangeEndpoint): EncodedEndpoint =>
      point.kind === 'text'
        ? { kind: 'text', key: context.node(point.id)!.key, offset: point.offset }
        : { kind: 'node', key: context.node(point.id)!.key, side: point.side };

    return {
      type: this.type,
      version: 1,
      data: { anchor: write(this.anchor), head: write(this.head), upstream: this.upstream },
    };
  }
  replace(context: SelectionContext, text: string): SelectionEdit {
    const ranges = this.ranges(context),
      firstText = ranges.findIndex((range) => range.kind === 'text');

    if (firstText < 0 && text)
      throw new Error('Replacing nodes with text requires a schema insertion command');

    const prefix = firstText < 0 ? ranges : ranges.slice(0, firstText),
      steps: SelectionStep[] = [];

    for (const range of [...prefix].toReversed()) {
      const location = context.location(range.id);

      if (!location) throw new Error('Missing selection node');
      const prior = steps.at(-1);

      if (
        prior?.kind === 'removeChildren' &&
        prior.parent === location.parent &&
        location.index + 1 === prior.index
      ) {
        prior.index = location.index;
        prior.count++;
      } else steps.push({ kind: 'removeChildren', ...location, count: 1 });
    }

    const first = ranges[firstText];

    if (first?.kind === 'text') {
      steps.push({ kind: 'replaceRanges', ranges: ranges.slice(firstText), text, pruneEmpty: [] });

      return { steps, selection: textSelection(first.id, first.from + text.length) };
    }

    return { steps };
  }
}

class RangeBookmark implements SelectionBookmark {
  constructor(
    readonly anchor: RangeEndpoint,
    readonly head: RangeEndpoint,
    readonly upstream: boolean,
  ) {}
  map(mapping: SelectionMapping): SelectionBookmark {
    const anchor = mapping.endpoint(this.anchor),
      head = mapping.endpoint(this.head);

    return anchor && head
      ? new RangeBookmark(anchor, head, this.upstream)
      : {
          map() {
            return this;
          },
          resolve: selectionNear,
        };
  }
  resolve(context: SelectionContext): Selection {
    const next = rangeSelection(this.anchor, this.head, this.upstream);

    try {
      next.validate(context);

      return next;
    } catch {
      return selectionNear(context);
    }
  }
}

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type -- This codec is the external serialized-selection boundary; it validates unknown payloads before constructing endpoints. */
function readEndpoint(context: SelectionContext, value: unknown): RangeEndpoint {
  const data = record(value);

  if (data.kind === 'text') {
    if (
      typeof data.key !== 'string' ||
      typeof data.offset !== 'number' ||
      !Number.isSafeInteger(data.offset)
    )
      throw new Error('Invalid text endpoint');
    const node = context.byKey(data.key);

    if (!node) throw new Error('Missing endpoint key');
    const point: RangeEndpoint = { kind: 'text', id: node.id, offset: data.offset };
    endpointOffset(context, point);

    return point;
  }

  if (
    data.kind !== 'node' ||
    typeof data.key !== 'string' ||
    (data.side !== 'before' && data.side !== 'after')
  )
    throw new Error('Invalid structural endpoint');
  const node = context.byKey(data.key);

  if (!node) throw new Error('Missing endpoint key');

  return { kind: 'node', id: node.id, side: data.side };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid range data');

  return Object.fromEntries(Object.entries(value));
}

function sameEndpoint(a: RangeEndpoint, b: RangeEndpoint) {
  return (
    a.id === b.id &&
    (a.kind === 'text'
      ? b.kind === 'text' && a.offset === b.offset
      : b.kind === 'node' && a.side === b.side)
  );
}

export function readRangeSelection(context: SelectionContext, value: unknown) {
  const data = record(value);

  if (typeof data.upstream !== 'boolean') throw new Error('Invalid range affinity');

  return new RangeSelection(
    readEndpoint(context, data.anchor),
    readEndpoint(context, data.head),
    data.upstream,
  );
}

/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type */

/** Map structural edges through text splits/joins and container removal. */
export function mapRangeEndpoint(
  before: SelectionContext,
  after: SelectionContext,
  maps: readonly PositionMap[],
  point: RangeEndpoint,
): RangeEndpoint | null {
  let next = point;

  for (const map of maps) {
    if (next.kind === 'text') {
      const moved = mapPosition(next.id, next.offset, 1, map);
      next = { kind: 'text', id: moved.id, offset: moved.index };
    } else if (map.kind === 'split' && next.id === map.id && next.side === 'after')
      next = { ...next, id: map.rightId };
    else if (map.kind === 'join') {
      if (next.id === map.right)
        next =
          next.side === 'before'
            ? { kind: 'text', id: map.left, offset: map.at }
            : { ...next, id: map.left };
      else if (next.id === map.left && next.side === 'after')
        next = { kind: 'text', id: map.left, offset: map.at };
    } else if (map.kind === 'unwrap' && next.id === map.id) {
      const children = before.children(map.id),
        child = next.side === 'before' ? children[0] : children.at(-1);

      if (child) next = { ...next, id: child.id };
    }
  }

  if (after.node(next.id)) return next;
  let location = before.location(point.id);

  while (
    location?.parent !== null &&
    location?.parent !== undefined &&
    !after.node(location.parent)
  )
    location = before.location(location.parent);

  if (!location) return null;

  let gap = {
    parent: location.parent,
    index: location.index + (point.kind === 'node' && point.side === 'after' ? 1 : 0),
  };

  for (const map of maps)
    gap = mapGapPosition(gap, point.kind === 'node' && point.side === 'after' ? -1 : 1, map);

  const children = after.children(gap.parent),
    right = children[gap.index],
    left = children[gap.index - 1];

  if (right) return { kind: 'node', id: right.id, side: 'before' };

  if (left) return { kind: 'node', id: left.id, side: 'after' };

  return null;
}
