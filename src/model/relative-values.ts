import { z } from 'zod';

import { bindParser } from './schema-codec';

export type RelativePosition = Readonly<{
  version: 1;
  documentId: string;
  revision: number;
  key: string;
  offset: number;
  association: -1 | 1;
}>;

export type RelativeRange = Readonly<{
  version: 1;
  start: RelativePosition;
  end: RelativePosition;
}>;

const positionInteger = z.number().int().nonnegative();

const identity = z.string().min(1);

const bias = z.union([z.literal(-1), z.literal(1)]);

const relativePosition = z
  .object({
    version: z.literal(1),
    documentId: identity,
    revision: positionInteger,
    key: identity,
    offset: positionInteger,
    association: bias,
  })
  .readonly();

export const parseRelativePosition = bindParser(relativePosition);

export const parseRelativeRange = bindParser(
  z
    .object({ version: z.literal(1), start: relativePosition, end: relativePosition })
    .refine(
      (data) =>
        data.start.documentId === data.end.documentId && data.start.revision === data.end.revision,
      'Range endpoints must share a document snapshot',
    )
    .readonly(),
);
