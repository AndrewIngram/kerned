import type { RelativeEndpoint, DocumentRange, SelectionRange } from '../model';
import { RangeSelection, endpointOffset, type RangeEndpoint } from './range-selection';
import { type RelativePositionResult } from './relative-positions';
import { AllSelection, NodeSelection, TextSelection, type SelectionContext } from './selection';
import { type Selection } from './selection-base';

export type DocumentRangeResult =
  | { status: 'resolved'; ranges: readonly SelectionRange[] }
  | Exclude<RelativePositionResult, { status: 'resolved' }>;

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
