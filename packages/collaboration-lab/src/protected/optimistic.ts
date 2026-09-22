import { validateTextRange } from '@gprose/model';

import { rebase, sameEdit, mapSelection, type PresenceSelection, type Edit } from '../protocol.js';
import { createProtectedRecipient } from './recipient.js';
import { readableSelection } from './selection.js';
import { decodeFrame, decodeProposal, type Frame } from './wire.js';

type Draft = { id: number; edit: Edit };

type Result =
  | { id: number; kind: 'confirmed' }
  | { id: number; kind: 'discarded'; reason: 'conflict' | 'precondition' | 'rejected' | 'reset' };

/** One immutable request in flight, with further edits in optimistic coordinates.
 * Only a projected frame can settle requests: a standalone receipt does not prove
 * which document view includes the accepted edit. */
export function createOptimisticRecipient(
  session: string,
  partitions?: Parameters<typeof createProtectedRecipient>[1],
) {
  const recipient = createProtectedRecipient(session, partitions);
  let queue: Draft[] = [];
  let flight: { id: number; key: string; operation: number; bytes: Uint8Array } | null = null;
  let results: Result[] = [];
  let nextId = 0;
  let needsReset = false;
  let selection: PresenceSelection | null = null;

  function texts() {
    return new Map(
      Object.entries(recipient.snapshot().bodies).flatMap(([key, body]) =>
        body.text === null ? [] : [[key, body.text] as const],
      ),
    );
  }

  function visibleTexts() {
    const values = texts();

    for (const draft of queue) apply(values, draft.edit);

    return values;
  }

  function clearSelectionIn(key: string) {
    if (selection?.anchor.key === key || selection?.head.key === key) selection = null;
  }

  function discard(key: string, reason: Extract<Result, { kind: 'discarded' }>['reason']) {
    clearSelectionIn(key);
    queue = queue.filter((draft) => {
      if (draft.edit.key !== key) return true;
      results.push({ id: draft.id, kind: 'discarded', reason });

      return false;
    });
  }

  function reset(frame?: Frame) {
    selection = null;

    const accepted =
      flight &&
      frame?.writes.receipts.some(
        (receipt) => receipt.kind === 'accepted' && receipt.operation === flight?.operation,
      )
        ? flight.id
        : null;

    if (accepted !== null) results.push({ id: accepted, kind: 'confirmed' });

    for (const draft of queue) {
      if (draft.id !== accepted) results.push({ id: draft.id, kind: 'discarded', reason: 'reset' });
    }

    queue = [];
    flight = null;
  }

  function reconcile(frame: Frame) {
    for (const change of frame.writes.changes) {
      if (flight && change.operation === flight.operation) {
        const own = queue.find((draft) => draft.id === flight?.id);

        if (own && !sameEdit(own.edit, change.edit)) throw new Error('Accepted edit mismatch');

        results.push({ id: flight.id, kind: 'confirmed' });
        queue = queue.filter((draft) => draft.id !== flight?.id);
        flight = null;

        // A discarded overlay can still be accepted later. Fresh drafts authored
        // without that overlay must be mapped over its eventual canonical edit.
        if (own) continue;
      }

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
          clearSelectionIn(draft.edit.key);
          results.push({ id: draft.id, kind: 'discarded', reason: 'conflict' });
        } else {
          mapped.push({ id: draft.id, edit: local });
          over = remote;
        }
      }

      queue = mapped;
      selection = mapSelection(selection, over);
    }

    if (flight) {
      const receipt = frame.writes.receipts.find(
        (value) => value.kind !== 'invalid' && value.operation === flight?.operation,
      );

      if (receipt?.kind === 'rejected') {
        if (queue.some((draft) => draft.id === flight?.id)) discard(flight.key, 'rejected');
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
        clearSelectionIn(draft.edit.key);
        results.push({ id: draft.id, kind: 'discarded', reason: 'precondition' });
      }
    }

    queue = valid;

    if (!readableSelection(selection, visibleTexts(), frame.manifest)) selection = null;
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
      selection = mapSelection(selection, edit);

      if (!readableSelection(selection, values, snapshot.manifest)) selection = null;

      return id;
    },
    select(value: PresenceSelection | null) {
      if (needsReset || recipient.status !== 'ready') throw new Error('Recipient not ready');

      if (!readableSelection(value, visibleTexts(), recipient.snapshot().manifest))
        throw new Error('Invalid selection');
      selection = structuredClone(value);
    },
    get selection() {
      return structuredClone(selection);
    },
    presence() {
      if (needsReset || recipient.status !== 'ready') return null;
      let confirmed = selection;

      for (const { edit } of queue.toReversed()) {
        confirmed = mapSelection(confirmed, {
          key: edit.key,
          from: edit.from,
          to: edit.from + edit.text.length,
          text: edit.expected,
          expected: edit.text,
        });
      }

      if (!readableSelection(confirmed, texts(), recipient.snapshot().manifest)) confirmed = null;

      return recipient.presence(confirmed);
    },
    remoteSelections() {
      if (needsReset || recipient.status !== 'ready') return [];
      const snapshot = recipient.snapshot();
      const values = visibleTexts();

      return snapshot.presence.flatMap((peer) => {
        let mapped: PresenceSelection | null = peer.selection;

        for (const draft of queue) mapped = mapSelection(mapped, draft.edit);

        return mapped && readableSelection(mapped, values, snapshot.manifest)
          ? [{ session: peer.session, selection: mapped }]
          : [];
      });
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
    snapshot() {
      return recipient.snapshot();
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
      selection = null;
      recipient.destroy();
    },
  };
}

function apply(values: Map<string, string>, edit: Edit) {
  const before = values.get(edit.key);

  if (before === undefined || before.slice(edit.from, edit.to) !== edit.expected)
    throw new Error('Edit precondition failed');
  validateTextRange(before, edit.from, edit.to);
  values.set(edit.key, before.slice(0, edit.from) + edit.text + before.slice(edit.to));
}
