import { z } from 'zod';

import { bindParser } from './schema-codec';

/** A gap attached to a surviving child edge. No runtime IDs or range registration. */
export type RelativeGap = Readonly<{
  version: 1;
  kind: 'gap';
  documentId: string;
  parentKey: string | null;
  beforeKey: string | null;
  afterKey: string | null;
  association: -1 | 1;
}>;

export const parseRelativeGap = bindParser(
  z
    .object({
      version: z.literal(1),
      kind: z.literal('gap'),
      documentId: z.string().min(1),
      parentKey: z.string().min(1).nullable(),
      beforeKey: z.string().min(1).nullable(),
      afterKey: z.string().min(1).nullable(),
      association: z.union([z.literal(-1), z.literal(1)]),
    })
    .refine(
      (data) => data.beforeKey === null || data.beforeKey !== data.afterKey,
      'Gap edges must be distinct',
    )
    .readonly(),
);
