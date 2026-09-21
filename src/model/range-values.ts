import {
  parseRelativePosition,
  parseRelativeRange,
  type RelativePosition,
  type RelativeRange,
} from './relative-values';

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
