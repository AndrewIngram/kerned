import type { DocumentRange, DocumentRangeResult } from './document-ranges';
import type { RelativeRange, RelativeRangeResult } from './relative-positions';
import type { SelectionRange } from './selection';

/** Feature-owned input. Decoration IDs identify view instances, not registered document ranges. */
export type InlineDecoration<Data> = { id: string; range: RelativeRange; data: Data };

export type ResolvedDecoration<Data> = {
  id: string;
  data: Data;
  ranges: readonly { id: number; from: number; to: number }[];
};

export type UnresolvedDecoration = {
  id: string;
  result: Exclude<RelativeRangeResult, { status: 'resolved' }>;
};

/** Feed resolved node-local ranges to canvas geometry or a DOM/React renderer. */
export function resolveDecorations<Data>(
  decorations: readonly InlineDecoration<Data>[],
  positions: { resolveRange(range: RelativeRange): RelativeRangeResult },
) {
  const resolved: ResolvedDecoration<Data>[] = [],
    unresolved: UnresolvedDecoration[] = [];

  for (const decoration of decorations) {
    const result = positions.resolveRange(decoration.range);

    if (result.status === 'resolved')
      resolved.push({ id: decoration.id, data: decoration.data, ranges: result.ranges });
    else unresolved.push({ id: decoration.id, result });
  }

  return { resolved, unresolved };
}

/** Structural decorations cover whole nodes as well as text slices. */
export type RangeDecoration<Data> = { id: string; range: DocumentRange; data: Data };

export function resolveRangeDecorations<Data>(
  decorations: readonly RangeDecoration<Data>[],
  positions: { resolveDocumentRange(range: DocumentRange): DocumentRangeResult },
) {
  const resolved: { id: string; data: Data; ranges: readonly SelectionRange[] }[] = [],
    unresolved: UnresolvedDecoration[] = [];

  for (const decoration of decorations) {
    const result = positions.resolveDocumentRange(decoration.range);

    if (result.status === 'resolved')
      resolved.push({ id: decoration.id, data: decoration.data, ranges: result.ranges });
    else unresolved.push({ id: decoration.id, result });
  }

  return { resolved, unresolved };
}
