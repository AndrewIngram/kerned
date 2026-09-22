import { validateTextRange } from '@gprose/model';

import { rebase, sameEdit, type Edit } from '../protocol.js';
import { createProtectedRecipient } from './recipient.js';
import { decodeFrame, decodeProposal, type Frame } from './wire.js';

type Draft = { id: number; edit: Edit };

type Result =
  | { id: number; kind: 'confirmed' }
  | { id: number; kind: 'discarded'; reason: 'conflict' | 'precondition' | 'rejected' | 'reset' };

/** One immutable request in flight, with further edits in optimistic coordinates.
 * Only a projected frame can settle requests: a standalone receipt does not prove
 * which document view includes the accepted edit. */
export function createOptimisticRecipient(session: string) {
  const recipient = createProtectedRecipient(session);
  let queue: Draft[] = [];
  let flight: { id: number; key: string; operation: number; bytes: Uint8Array } | null = null;
  let results: Result[] = [];
  let nextId = 0;
  let needsReset = false;

  function texts() {
    return new Map(
      Object.entries(recipient.snapshot().bodies).flatMap(([key, body]) =>
        body.text === null ? [] : [[key, body.text] as const],
      ),
    );
  }

  function apply(values: Map<string, string>, edit: Edit) {
    const before = values.get(edit.key);

    if (before === undefined || before.slice(edit.from, edit.to) !== edit.expected)
      throw new Error('Edit precondition failed');
    validateTextRange(before, edit.from, edit.to);
    values.set(edit.key, before.slice(0, edit.from) + edit.text + before.slice(edit.to));
  }

  function discard(key: string, reason: Extract<Result, { kind: 'discarded' }>['reason']) {
    queue = queue.filter((draft) => {
      if (draft.edit.key !== key) return true;
      results.push({ id: draft.id, kind: 'discarded', reason });

      return false;
    });
  }

  function reset(frame?: Frame) {
    for (const draft of queue) {
      const accepted =
        draft.id === flight?.id &&
        frame?.writes.receipts.some(
          (receipt) => receipt.kind === 'accepted' && receipt.operation === flight?.operation,
        );

      results.push(
        accepted
          ? { id: draft.id, kind: 'confirmed' }
          : { id: draft.id, kind: 'discarded', reason: 'reset' },
      );
    }

    queue = [];
    flight = null;
  }

  function reconcile(frame: Frame) {
    for (const change of frame.writes.changes) {
      if (flight && change.operation === flight.operation) {
        const own = queue.find((draft) => draft.id === flight?.id);

        if (own && !sameEdit(own.edit, change.edit)) throw new Error('Accepted edit mismatch');

        if (own) results.push({ id: own.id, kind: 'confirmed' });
        queue = queue.filter((draft) => draft.id !== flight?.id);
        flight = null;
      } else {
        let over = change.edit;
        const mapped: Draft[] = [];
        const conflicts = new Set<string>();

        for (const draft of queue) {
          if (conflicts.has(draft.edit.key)) {
            results.push({ id: draft.id, kind: 'discarded', reason: 'conflict' });
            continue;
          }

          const local = rebase(draft.edit, over);
          const remote = rebase(over, draft.edit, false);

          if (!local || !remote) {
            conflicts.add(draft.edit.key);
            results.push({ id: draft.id, kind: 'discarded', reason: 'conflict' });
          } else {
            mapped.push({ id: draft.id, edit: local });
            over = remote;
          }
        }

        queue = mapped;
      }
    }

    if (flight) {
      const receipt = frame.writes.receipts.find(
        (value) => value.kind !== 'invalid' && value.operation === flight?.operation,
      );

      if (receipt?.kind === 'rejected') {
        discard(flight.key, 'rejected');
        flight = null;
      } else if (receipt?.kind === 'accepted') throw new Error('Missing accepted edit');
    }

    const values = texts();
    const invalid = new Set<string>();
    const valid: Draft[] = [];

    for (const draft of queue) {
      if (invalid.has(draft.edit.key)) {
        results.push({ id: draft.id, kind: 'discarded', reason: 'precondition' });
        continue;
      }

      try {
        apply(values, draft.edit);
        valid.push(draft);
      } catch {
        invalid.add(draft.edit.key);
        results.push({ id: draft.id, kind: 'discarded', reason: 'precondition' });
      }
    }

    queue = valid;
  }

  return {
    edit(value: Omit<Edit, 'expected'>) {
      if (needsReset || recipient.status !== 'ready') throw new Error('Recipient not ready');
      const snapshot = recipient.snapshot();
      const node = snapshot.manifest.find((item) => item.key === value.key);

      if (node?.kind !== 'visible' || node.access !== 'editable')
        throw new Error('Target not editable');
      const values = texts();

      for (const draft of queue) apply(values, draft.edit);
      const text = values.get(value.key);

      if (text === undefined) throw new Error('Missing text');
      const edit = { ...value, expected: text.slice(value.from, value.to) };
      apply(values, edit);
      const id = ++nextId;
      queue.push({ id, edit });

      return id;
    },
    request() {
      if (needsReset || recipient.status !== 'ready') return null;

      if (flight) return flight.bytes.slice();
      const first = queue[0];

      if (!first) return null;
      const bytes = recipient.propose(first.edit);
      flight = {
        id: first.id,
        key: first.edit.key,
        operation: decodeProposal(bytes).operation,
        bytes,
      };

      return bytes.slice();
    },
    receive(bytes: Uint8Array) {
      try {
        const frame = decodeFrame(bytes);

        if (needsReset && frame.base !== null) return false;
        const received = recipient.receive(bytes);

        if (!received) {
          if (recipient.status === 'resync') reset();

          return false;
        }

        if (frame.base === null) reset(frame);
        else reconcile(frame);
        needsReset = false;

        return true;
      } catch (error) {
        reset();
        needsReset = true;
        throw error;
      }
    },
    text(key: string) {
      if (needsReset) return undefined;
      const values = texts();

      for (const draft of queue) apply(values, draft.edit);

      return values.get(key);
    },
    get pending() {
      return queue.length;
    },
    get status() {
      return needsReset ? 'resync' : recipient.status;
    },
    takeResults() {
      const taken = results;
      results = [];

      return taken;
    },
    destroy() {
      queue = [];
      flight = null;
      results = [];
      recipient.destroy();
    },
  };
}
