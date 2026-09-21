import { z } from 'zod';

import { bindParser } from './schema-codec';

/** Persist this value alongside the document's ID, revision and mapping journal. */
export type Anchor = {
  version: 1;
  documentId: string;
  revision: number;
  blockKey: string;
  offset: number;
  bias: -1 | 1;
  deleted: boolean;
};

export const parseAnchor = bindParser(
  z.object({
    version: z.literal(1),
    documentId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    blockKey: z.string().min(1),
    offset: z.number().int().nonnegative(),
    bias: z.union([z.literal(-1), z.literal(1)]),
    deleted: z.boolean(),
  }),
);
