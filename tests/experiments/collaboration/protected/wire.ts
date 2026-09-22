import { z } from 'zod';

import { editSchema } from '../protocol.js';

const key = z.string().min(1);

export const bodySchema = z.object({
  type: key,
  data: z.json(),
  text: z.string().nullable(),
});

export type Body = z.infer<typeof bodySchema>;

const location = { key, parent: key.nullable() };

const manifest = z.discriminatedUnion('kind', [
  z.object({ ...location, kind: z.literal('protected'), locked: z.boolean() }),
  z.object({ ...location, kind: z.literal('visible'), access: z.enum(['editable', 'read-only']) }),
]);

export type Manifest = z.infer<typeof manifest>;

const point = z.object({
  key,
  offset: z.number().int().nonnegative(),
  association: z.union([z.literal(-1), z.literal(1)]),
});

const selection = z.object({ anchor: point, head: point });

const update = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('json'), key, body: bodySchema }),
  z.object({
    kind: z.literal('automerge'),
    key,
    mode: z.enum(['snapshot', 'changes']),
    bytes: z.array(z.array(z.number().int().min(0).max(255))),
  }),
]);

export type Update = z.infer<typeof update>;

const attachment = z.discriminatedUnion('status', [
  z.object({ id: key, status: z.literal('unavailable') }),
  z.object({ id: key, status: z.literal('ready'), key, body: z.string() }),
]);

export type AttachmentResult = z.infer<typeof attachment>;

const receiptSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('invalid') }),
  z.object({ kind: z.literal('accepted'), operation: z.number().int().positive() }),
  z.object({
    kind: z.literal('rejected'),
    operation: z.number().int().positive(),
    reason: z.enum(['denied', 'stale', 'conflict', 'precondition', 'identity']),
  }),
]);

export type WriteReceipt = z.infer<typeof receiptSchema>;

const frameSchema = z.object({
  session: key,
  epoch: z.number().int().positive(),
  sequence: z.number().int().positive(),
  base: z.number().int().nonnegative().nullable(),
  manifest: z.array(manifest),
  updates: z.array(update),
  comments: z.array(z.object({ id: key, from: key, to: key, text: z.string() })),
  outline: z.array(z.object({ key, title: z.string() })),
  presence: z.array(z.object({ session: key, selection })),
  attachments: z.array(attachment),
  writes: z.object({
    changes: z.array(
      z.object({ edit: editSchema, operation: z.number().int().positive().nullable() }),
    ),
    receipts: z.array(receiptSchema),
  }),
});

export type Frame = z.infer<typeof frameSchema>;

export function encodeFrame(frame: Frame) {
  return new TextEncoder().encode(JSON.stringify(frame));
}

export function decodeFrame(bytes: Uint8Array): Frame {
  return frameSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

const proposalSchema = z.object({
  session: key,
  operation: z.number().int().positive(),
  epoch: z.number().int().positive(),
  base: z.number().int().positive(),
  edit: editSchema,
});

export type ProjectedProposal = z.infer<typeof proposalSchema>;

export function encodeProposal(value: ProjectedProposal) {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function decodeProposal(bytes: Uint8Array): ProjectedProposal {
  return proposalSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

export function encodeReceipt(value: WriteReceipt) {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function decodeReceipt(bytes: Uint8Array): WriteReceipt {
  return receiptSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}
