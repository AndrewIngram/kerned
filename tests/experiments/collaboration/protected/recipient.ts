import * as Automerge from '@automerge/automerge';
import { validateTextRange } from '@gprose/model';

import type { Edit } from '../protocol.js';
import { bodySchema, decodeFrame, encodeProposal, type Body, type Frame } from './wire.js';

/** A cooperative recipient. An application cannot erase copies a hostile recipient
 * made while it was authorized. Frames from an older session/sequence are ignored. */
export function createProtectedRecipient(session: string) {
  let sequence = 0,
    epoch = 0;

  let status: 'empty' | 'ready' | 'resync' = 'empty';
  let latest: Frame | null = null;
  let destroyed = false;
  let operation = 0;
  const bodies = new Map<string, Body>();
  const docs = new Map<string, Automerge.Doc<{ body: Body }>>();
  const attachments = new Map<string, { key: string; body: string }>();

  function clear() {
    bodies.clear();
    attachments.clear();
    latest = null;

    for (const doc of docs.values()) Automerge.free(doc);
    docs.clear();
  }

  return {
    receive(bytes: Uint8Array) {
      if (destroyed) throw new Error('Recipient destroyed');
      const frame = decodeFrame(bytes);

      if (frame.session !== session || frame.sequence <= sequence || frame.epoch < epoch)
        return false;

      const gap =
        frame.base !== null &&
        (frame.base !== sequence || frame.epoch !== epoch || status !== 'ready');

      sequence = frame.sequence;
      epoch = frame.epoch;

      if (gap) {
        clear();
        status = 'resync';

        return false;
      }

      if (frame.base === null) clear();

      const readable = new Set(
        frame.manifest.filter((item) => item.kind === 'visible').map((item) => item.key),
      );

      for (const key of bodies.keys()) if (!readable.has(key)) bodies.delete(key);

      for (const [key, doc] of docs)
        if (!readable.has(key)) {
          Automerge.free(doc);
          docs.delete(key);
        }

      for (const [id, value] of attachments) if (!readable.has(value.key)) attachments.delete(id);

      try {
        for (const update of frame.updates) {
          if (!readable.has(update.key)) throw new Error('Payload outside readable manifest');

          if (update.kind === 'json') {
            bodies.set(update.key, update.body);
          } else {
            if (update.mode === 'snapshot') {
              const previous = docs.get(update.key);

              if (previous) Automerge.free(previous);
              docs.set(update.key, Automerge.load<{ body: Body }>(new Uint8Array(update.bytes[0])));
            } else {
              const doc = docs.get(update.key);

              if (!doc) throw new Error('Missing partition');

              const [next] = Automerge.applyChanges(
                doc,
                update.bytes.map((value) => new Uint8Array(value)),
              );

              docs.set(update.key, next);
            }

            const doc = docs.get(update.key);

            if (!doc) throw new Error('Missing partition');
            bodies.set(update.key, bodySchema.parse(doc.body));
          }
        }

        if ([...readable].some((key) => !bodies.has(key))) throw new Error('Incomplete projection');

        for (const item of frame.attachments) {
          if (item.status === 'unavailable') attachments.delete(item.id);
          else {
            if (!readable.has(item.key)) throw new Error('Attachment outside readable manifest');
            attachments.set(item.id, { key: item.key, body: item.body });
          }
        }

        // Native docs retain only admitted partitions. Don't retain delivered byte
        // arrays as an extra cache after they have been applied.
        latest = { ...frame, updates: [], attachments: [], writes: { changes: [], receipts: [] } };
        status = 'ready';

        return true;
      } catch (error) {
        clear();
        status = 'resync';
        throw error;
      }
    },
    propose(edit: Omit<Edit, 'expected'>) {
      if (destroyed || status !== 'ready' || !latest) throw new Error('Recipient not ready');
      const entry = latest.manifest.find((item) => item.key === edit.key);
      const body = bodies.get(edit.key);

      if (entry?.kind !== 'visible' || entry.access !== 'editable' || !body || body.text === null)
        throw new Error('Target not editable');
      validateTextRange(body.text, edit.from, edit.to);

      return encodeProposal({
        session,
        epoch,
        base: sequence,
        operation: ++operation,
        edit: { ...edit, expected: body.text.slice(edit.from, edit.to) },
      });
    },
    get status() {
      return status;
    },
    snapshot() {
      return structuredClone({
        manifest: latest?.manifest ?? [],
        bodies: Object.fromEntries(bodies),
        comments: latest?.comments ?? [],
        outline: latest?.outline ?? [],
        presence: latest?.presence ?? [],
        attachments: Object.fromEntries(attachments),
      });
    },
    search(query: string) {
      return [...bodies].flatMap(([key, body]) =>
        body.text?.includes(query) ? [{ key, text: body.text }] : [],
      );
    },
    destroy() {
      destroyed = true;
      clear();
      status = 'empty';
    },
  };
}
