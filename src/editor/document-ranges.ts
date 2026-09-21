import {
  parseRelativePosition,
  parseRelativeRange,
  type RelativePosition,
  type RelativeRange,
  type RelativePositionResult,
} from './relative-positions';
import {
  AllSelection,
  NodeSelection,
  TextSelection,
  type Selection,
  type SelectionContext,
  type SelectionRange,
} from './selection';
import { RangeSelection, endpointOffset, type RangeEndpoint } from './range-selection';

export type RelativeNodeBoundary = Readonly<
  Omit<RelativePosition, 'offset'> & { side: 'before' | 'after' }
>;

export type RelativeEndpoint = RelativePosition | RelativeNodeBoundary;

/** No range identity or registration. Text-only values retain their existing wire format. */
export type DocumentRange =
  | RelativeRange
  | Readonly<{
      version: 1;
      kind: 'structural';
      start: RelativeEndpoint;
      end: RelativeEndpoint;
    }>;

export type DocumentRangeResult =
  | { status: 'resolved'; ranges: readonly SelectionRange[] }
  | Exclude<RelativePositionResult, { status: 'resolved' }>;

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type -- Untrusted persisted reference codecs. */
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid document range');

  return Object.fromEntries(Object.entries(value));
}

export function parseRelativeEndpoint(value: unknown): RelativeEndpoint {
  const data = record(value);

  if (!('side' in data)) return parseRelativePosition(data);

  if ('offset' in data || (data.side !== 'before' && data.side !== 'after'))
    throw new Error('Invalid node boundary');
  const { offset: _offset, ...position } = parseRelativePosition({ ...data, offset: 0 });

  return Object.freeze({ ...position, side: data.side });
}

export function parseDocumentRange(value: unknown): DocumentRange {
  const data = record(value);

  if (!('kind' in data)) return parseRelativeRange(data);

  if (data.version !== 1 || data.kind !== 'structural')
    throw new Error('Invalid document range version');

  const start = parseRelativeEndpoint(data.start),
    end = parseRelativeEndpoint(data.end);

  if (start.documentId !== end.documentId || start.revision !== end.revision)
    throw new Error('Range endpoints must share a document snapshot');

  return Object.freeze({ version: 1, kind: 'structural', start, end });
}
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type */

/** Capture only contiguous selection kinds. A rectangular cell selection is not a range. */
export function captureDocumentRange(
  selection: Selection,
  context: SelectionContext,
  at: (endpoint: RangeEndpoint, association: -1 | 1) => RelativeEndpoint,
): DocumentRange | null {
  let start: RangeEndpoint, end: RangeEndpoint;

  if (selection instanceof TextSelection) {
    start = { kind: 'text', ...selection.anchor };
    end = { kind: 'text', ...selection.head };
  } else if (selection instanceof RangeSelection) {
    start = selection.anchor;
    end = selection.head;
  } else if (selection instanceof NodeSelection) {
    start = { kind: 'node', id: selection.id, side: 'before' };
    end = { kind: 'node', id: selection.id, side: 'after' };
  } else if (selection instanceof AllSelection) {
    const nodes = context.children(null),
      first = nodes[0],
      last = nodes.at(-1);

    if (!first || !last) return null;
    start = { kind: 'node', id: first.id, side: 'before' };
    end = { kind: 'node', id: last.id, side: 'after' };
  } else return null;

  const a = endpointOffset(context, start),
    b = endpointOffset(context, end);

  if (a === b) return null;

  if (a > b) [start, end] = [end, start];

  const first = at(start, 1),
    last = at(end, -1);

  return 'side' in first || 'side' in last
    ? Object.freeze({ version: 1, kind: 'structural', start: first, end: last })
    : Object.freeze({ version: 1, start: first, end: last });
}

export function resolvedDocumentRange(
  context: SelectionContext,
  start: RangeEndpoint,
  end: RangeEndpoint,
): DocumentRangeResult {
  if (start.kind === 'text' && end.kind === 'text' && start.id === end.id)
    return start.offset < end.offset
      ? {
          status: 'resolved',
          ranges: [{ kind: 'text', id: start.id, from: start.offset, to: end.offset }],
        }
      : { status: 'deleted' };

  if (endpointOffset(context, start) >= endpointOffset(context, end)) return { status: 'deleted' };

  const ranges = new RangeSelection(start, end)
    .ranges(context)
    .filter((range) => range.kind === 'node' || range.from < range.to);

  return ranges.length ? { status: 'resolved', ranges } : { status: 'deleted' };
}
