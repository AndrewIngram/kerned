import { expect, test } from 'vitest';

import { createProtectedAuthority } from '../packages/collaboration-lab/src/protected/authority.js';
import { createOptimisticRecipient } from '../packages/collaboration-lab/src/protected/optimistic.js';
import {
  createPartitions,
  createReceivedPartitions,
} from '../packages/collaboration-lab/src/protected/partitions.js';
import {
  decodeFrame,
  decodeProposal,
  decodeReceipt,
} from '../packages/collaboration-lab/src/protected/wire.js';
import { replacementCases, schema } from './experiments/collaboration/fixtures.js';
import { inspectWire } from './experiments/collaboration/protected/audit.js';

const insert = (from: number, text: string, key = 'one') => ({ key, from, to: from, text });

function fixture(mode: 'json' | 'automerge') {
  const authority = createProtectedAuthority({
    schema,
    nodes: [
      { kind: 'note', id: 1, key: 'one', value: 'abcd' },
      { kind: 'note', id: 2, key: 'two', value: 'next' },
      { kind: 'note', id: 3, key: 'hidden', value: 'PRIVATE_TEXT' },
    ],
    delivery:
      mode === 'json' ? { kind: 'json' } : { kind: 'automerge', partitions: createPartitions() },
    users: { guest: 'editable' },
    comments: [],
    attachments: [],
    title: () => null,
  });

  authority.setAccess('guest', 'hidden', 'protected');
  const frames: Uint8Array[] = [];
  const connection = authority.connect('guest', (bytes) => frames.push(bytes.slice()));
  const client = createOptimisticRecipient(connection.session, createReceivedPartitions());

  function flush() {
    const sent = connection.flush();

    if (sent) client.receive(frames[frames.length - 1]);

    return sent;
  }

  flush();

  function request() {
    const bytes = client.request();

    if (!bytes) throw new Error('Expected a pending request');

    return bytes;
  }

  function submit() {
    return decodeReceipt(connection.submit(request()));
  }

  function drain() {
    for (let count = 0; count < 100 && client.pending; count++) {
      submit();
      flush();
    }

    expect(client.pending).toBe(0);
  }

  return {
    authority,
    connection,
    client,
    frames,
    flush,
    request,
    submit,
    drain,
    destroy() {
      client.destroy();
      authority.destroy();
    },
  };
}

for (const mode of ['json', 'automerge'] as const) {
  test(`${mode}: a delayed rejection preserves fresh typing after its old overlay was discarded`, () => {
    const f = fixture(mode);
    f.client.edit({ key: 'one', from: 1, to: 3, text: 'X' });
    f.request();
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 1, to: 3, text: 'R' }]);
    f.flush();
    f.client.takeResults();
    const fresh = f.client.edit(insert(3, '!'));
    expect(f.client.text('one')).toBe('aRd!');
    expect(f.submit()).toMatchObject({ kind: 'rejected', reason: 'conflict' });
    f.flush();
    expect(f.client.text('one')).toBe('aRd!');
    expect(f.client.takeResults()).toEqual([]);
    f.drain();
    expect(f.client.takeResults()).toEqual([{ id: fresh, kind: 'confirmed' }]);
    expect(f.client.text('one')).toBe('aRd!');
    f.destroy();
  });

  test.each(['incremental', 'resync'])(
    `${mode}: late acceptance via %s settles a discarded overlay`,
    (delivery) => {
      const f = fixture(mode);
      f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 4, text: '🇦🇧🇨🇩' }]);
      f.flush();
      const original = f.client.edit({ key: 'one', from: 4, to: 8, text: 'X' });
      f.request();
      f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: '🇪' }]);
      f.flush();
      expect(f.client.takeResults()).toEqual([
        { id: original, kind: 'discarded', reason: 'precondition' },
      ]);
      const fresh = f.client.edit(insert(10, '!'));
      f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: '🇫' }]);
      f.flush();
      expect(f.client.text('one')).toBe('🇫🇪🇦🇧🇨🇩!');
      expect(f.submit().kind).toBe('accepted');

      if (delivery === 'resync') f.connection.resync();
      f.flush();
      const expected = delivery === 'resync' ? '🇫🇪🇦🇧X' : '🇫🇪🇦🇧X!';
      expect(f.client.text('one')).toBe(expected);
      f.drain();
      expect(f.client.text('one')).toBe(expected);
      expect(f.client.takeResults()).toEqual([
        { id: original, kind: 'confirmed' },
        delivery === 'resync'
          ? { id: fresh, kind: 'discarded', reason: 'reset' }
          : { id: fresh, kind: 'confirmed' },
      ]);
      f.destroy();
    },
  );

  test(`${mode}: all 225 replacement pairs reconcile queued typing without losing accepted heads`, () => {
    let accepted = 0;
    let conflicted = 0;

    for (const pair of replacementCases()) {
      const f = fixture(mode);
      const head = f.client.edit(pair.second);
      f.request();
      f.client.edit(insert(f.client.text('one')?.length ?? 0, '!'));
      f.authority.apply([
        {
          kind: 'replaceText',
          id: 1,
          from: pair.first.from,
          to: pair.first.to,
          text: pair.first.text,
        },
      ]);
      const outcome = f.submit();
      f.flush();
      const result = f.client.takeResults().find((value) => value.id === head);

      if (outcome.kind === 'accepted') accepted++;
      else conflicted++;
      expect(result?.kind).toBe(outcome.kind === 'accepted' ? 'confirmed' : 'discarded');
      f.drain();
      const frames: Uint8Array[] = [];
      const connection = f.authority.connect('guest', (bytes) => frames.push(bytes));
      const probe = createOptimisticRecipient(connection.session, createReceivedPartitions());
      connection.flush();
      probe.receive(frames[0]);
      expect(f.client.text('one')).toBe(probe.text('one'));
      probe.destroy();
      connection.close();
      f.destroy();
    }

    expect(accepted).toBe(135);
    expect(conflicted).toBe(90);
  });

  test(`${mode}: a conflict in the tail preserves the earlier valid in-flight edit`, () => {
    const f = fixture(mode);
    const head = f.client.edit(insert(4, 'X'));
    f.request();
    const tail = f.client.edit({ key: 'one', from: 1, to: 3, text: 'Q' });
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 1, to: 3, text: 'R' }]);
    f.flush();
    expect(f.client.text('one')).toBe('aRdX');
    expect(f.client.takeResults()).toEqual([{ id: tail, kind: 'discarded', reason: 'conflict' }]);
    expect(f.submit().kind).toBe('accepted');
    f.flush();
    expect(f.client.takeResults()).toEqual([{ id: head, kind: 'confirmed' }]);
    expect(f.client.text('one')).toBe('aRdX');
    f.destroy();
  });

  test(`${mode}: dependent typing is immediate while immutable requests settle only with their view`, () => {
    const f = fixture(mode);
    const a = f.client.edit(insert(1, 'X'));
    const request = f.request();
    const b = f.client.edit(insert(2, 'Y'));
    const c = f.client.edit({ key: 'one', from: 1, to: 2, text: '' });
    expect(f.client.text('one')).toBe('aYbcd');
    expect(f.request()).toEqual(request);
    const copy = f.request();
    copy.fill(0);
    expect(f.request()).toEqual(request);
    expect(f.submit().kind).toBe('accepted');
    expect(f.submit().kind).toBe('accepted');
    expect(f.client.pending).toBe(3);
    f.flush();
    expect(f.client.pending).toBe(2);
    expect(f.client.text('one')).toBe('aYbcd');
    expect(f.client.receive(f.frames[1])).toBe(false);
    f.drain();
    expect(f.client.text('one')).toBe('aYbcd');
    expect(f.client.takeResults()).toEqual([a, b, c].map((id) => ({ id, kind: 'confirmed' })));
    expect(f.client.takeResults()).toEqual([]);
    expect(f.client.request()).toBeNull();
    f.destroy();
  });

  test(`${mode}: queued edits rebase over remote insertions before and after acceptance`, () => {
    const f = fixture(mode);
    f.client.edit(insert(0, 'L'));
    f.request();
    f.client.edit(insert(1, '!'));
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'R' }]);
    f.flush();
    expect(f.client.text('one')).toBe('RL!abcd');
    expect(f.submit().kind).toBe('accepted');
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'Q' }]);
    f.flush();
    expect(f.client.text('one')).toBe('QRL!abcd');
    f.drain();
    expect(f.client.text('one')).toBe('QRL!abcd');
    expect(f.client.takeResults().map((result) => result.kind)).toEqual(['confirmed', 'confirmed']);
    f.destroy();
  });

  test(`${mode}: conflicting drafts discard same-block dependencies but retain another block`, () => {
    const f = fixture(mode);
    const first = f.client.edit({ key: 'one', from: 1, to: 3, text: 'X' });
    f.request();
    const dependent = f.client.edit(insert(2, '!'));
    const independent = f.client.edit(insert(0, '+', 'two'));
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 1, to: 3, text: 'R' }]);
    expect(f.submit()).toMatchObject({ kind: 'rejected', reason: 'conflict' });
    f.flush();
    expect(f.client.text('one')).toBe('aRd');
    expect(f.client.text('two')).toBe('+next');
    expect(f.client.takeResults()).toEqual(
      [first, dependent].map((id) => ({ id, kind: 'discarded', reason: 'conflict' })),
    );
    f.drain();
    expect(f.client.takeResults()).toEqual([{ id: independent, kind: 'confirmed' }]);
    f.destroy();
  });

  test(`${mode}: a lost response is retried once and a delivery gap discards uncertain overlays`, () => {
    const f = fixture(mode);
    f.client.edit(insert(0, 'X'));
    const bytes = f.request();
    f.client.edit(insert(1, 'Y'));
    f.connection.submit(bytes);
    f.connection.flush();
    f.authority.apply([{ kind: 'replaceText', id: 2, from: 0, to: 0, text: 'R' }]);
    f.connection.flush();
    expect(f.client.receive(f.frames[2])).toBe(false);
    expect(f.client.status).toBe('resync');
    expect(f.client.text('one')).toBeUndefined();
    expect(f.client.request()).toBeNull();
    expect(f.client.pending).toBe(0);
    f.connection.resync();
    f.flush();
    expect(f.client.text('one')).toBe('Xabcd');
    expect(decodeReceipt(f.connection.submit(bytes)).kind).toBe('accepted');
    expect(f.flush()).toBe(false);
    f.client.edit(insert(1, 'Z'));
    f.drain();
    expect(f.client.text('one')).toBe('XZabcd');
    expect(f.client.receive(f.frames[1])).toBe(false);
    f.destroy();
  });

  test(`${mode}: revocation erases queued text and regrant never resends old drafts`, () => {
    const f = fixture(mode);
    f.client.edit(insert(0, 'LOCAL_PRIVATE'));
    const bytes = f.request();
    f.client.edit(insert(13, '!'));
    f.authority.setAccess('guest', 'one', 'protected');
    expect(decodeReceipt(f.connection.submit(bytes))).toMatchObject({
      kind: 'rejected',
      reason: 'denied',
    });
    f.flush();
    expect(f.client.text('one')).toBeUndefined();
    expect(f.client.pending).toBe(0);
    expect(f.client.request()).toBeNull();
    expect(JSON.stringify(f.client.takeResults())).not.toContain('PRIVATE');
    expect(inspectWire([f.frames[1]])).not.toContain('PRIVATE');
    expect(() => f.client.edit(insert(0, 'x'))).toThrow('Target not editable');
    f.authority.setAccess('guest', 'one', 'editable');
    f.flush();
    expect(f.client.text('one')).toBe('abcd');
    expect(f.client.request()).toBeNull();
    f.destroy();
  });

  test(`${mode}: the visible journal detects ABA changes without leaking hidden edits`, () => {
    const f = fixture(mode);
    const id = f.client.edit({ key: 'one', from: 1, to: 2, text: 'X' });
    f.request();
    f.authority.apply([
      { kind: 'replaceText', id: 3, from: 0, to: 0, text: 'PRIVATE_UPDATE' },
      { kind: 'replaceText', id: 1, from: 1, to: 3, text: '' },
      { kind: 'replaceText', id: 1, from: 1, to: 1, text: 'bc' },
    ]);
    f.flush();
    expect(f.client.text('one')).toBe('abcd');
    expect(f.client.takeResults()).toEqual([{ id, kind: 'discarded', reason: 'conflict' }]);
    expect(decodeFrame(f.frames[1]).writes.changes).toHaveLength(2);
    expect(inspectWire(f.frames)).not.toContain('PRIVATE');
    expect(f.submit()).toMatchObject({ kind: 'rejected', reason: 'conflict' });
    f.flush();
    expect(f.client.request()).toBeNull();
    f.destroy();
  });

  test(`${mode}: rebased drafts must still lie on grapheme boundaries`, () => {
    const f = fixture(mode);
    const id = f.client.edit({ key: 'one', from: 0, to: 1, text: 'X' });
    f.request();
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 1, to: 1, text: '\u0301' }]);
    f.flush();
    expect(f.client.text('one')).toBe('a\u0301bcd');
    expect(f.client.takeResults()).toEqual([{ id, kind: 'discarded', reason: 'precondition' }]);
    expect(f.submit()).toMatchObject({ kind: 'rejected', reason: 'precondition' });
    f.flush();
    f.client.edit({ key: 'one', from: 0, to: 2, text: '😀' });
    f.client.edit(insert(2, 'مرحبا'));
    f.drain();
    expect(f.client.text('one')).toBe('😀مرحباbcd');
    f.destroy();
  });

  test(`${mode}: a full view settles an accepted request but discards its unconfirmed tail`, () => {
    const f = fixture(mode);
    const accepted = f.client.edit(insert(0, 'X'));
    f.submit();
    const tail = f.client.edit(insert(1, 'Y'));
    f.connection.resync();
    f.flush();
    expect(f.client.text('one')).toBe('Xabcd');
    expect(f.client.takeResults()).toEqual([
      { id: accepted, kind: 'confirmed' },
      { id: tail, kind: 'discarded', reason: 'reset' },
    ]);
    expect(f.client.request()).toBeNull();
    f.client.edit(insert(1, 'Z'));
    expect(decodeProposal(f.request()).operation).toBe(2);
    f.drain();
    expect(f.client.text('one')).toBe('XZabcd');
    f.destroy();
    expect(f.client.text('one')).toBeUndefined();
    expect(() => f.client.edit(insert(0, '!'))).toThrow('Recipient not ready');
  });
}
