import { validateTextRange } from '@kerned/model';

import type { Edit, PresenceSelection } from '../protocol.js';
import type { createReceivedPartitions } from './partitions.js';
import { readableSelection } from './selection.js';
import { decodeFrame, encodeProposal, encodePresence, type Body, type Frame } from './wire.js';

/** A cooperative recipient. An application cannot erase copies a hostile recipient
 * made while it was authorized. Frames from an older session/sequence are ignored. */
export function createProtectedRecipient(
  session: string,
  partitions?: ReturnType<typeof createReceivedPartitions>,
) {
  let sequence = 0,
    epoch = 0;

  let status: 'empty' | 'ready' | 'resync' = 'empty';
  let latest: Frame | null = null;
  let destroyed = false;
  let operation = 0;
  let presenceSequence = 0;
  const bodies = new Map<string, Body>();
  const attachments = new Map<string, { key: string; body: string }>();

  function clear() {
    bodies.clear();
    attachments.clear();
    latest = null;

    partitions?.clear();
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

      partitions?.retain(readable);

      for (const [id, value] of attachments) if (!readable.has(value.key)) attachments.delete(id);

      try {
        for (const update of frame.updates) {
          if (!readable.has(update.key)) throw new Error('Payload outside readable manifest');

          if (update.kind === 'json') {
            bodies.set(update.key, update.body);
          } else {
            if (!partitions) throw new Error('Automerge delivery is not installed');
            bodies.set(update.key, partitions.receive(update));
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
    presence(selection: PresenceSelection | null) {
      if (destroyed || status !== 'ready' || !latest) return null;

      const texts = new Map(
        [...bodies].flatMap(([key, body]) =>
          body.text === null ? [] : [[key, body.text] as const],
        ),
      );

      if (!readableSelection(selection, texts, latest.manifest))
        throw new Error('Invalid presence selection');

      return encodePresence({
        session,
        epoch,
        base: sequence,
        sequence: ++presenceSequence,
        selection,
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
