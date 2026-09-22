import { expect, test } from 'vitest';

import { createProtectedAuthority } from '../packages/collaboration-lab/src/protected/authority.js';
import {
  createPartitions,
  createReceivedPartitions,
} from '../packages/collaboration-lab/src/protected/partitions.js';
import { createProtectedRecipient } from '../packages/collaboration-lab/src/protected/recipient.js';
import {
  decodeFrame,
  decodeProposal,
  decodeReceipt,
  encodeProposal,
} from '../packages/collaboration-lab/src/protected/wire.js';
import { replacementCases, schema, type Node } from './experiments/collaboration/fixtures.js';
import { inspectWire } from './experiments/collaboration/protected/audit.js';

const secret = 'PRIVATE_CANONICAL_TEXT';

function fixture(mode: 'json' | 'automerge', value = 'abcd') {
  const nodes: Node[] = [
    { kind: 'note', id: 1, key: 'one', value },
    {
      kind: 'group',
      id: 2,
      key: 'sealed',
      children: [{ kind: 'note', id: 3, key: 'PRIVATE_DESCENDANT', value: secret }],
    },
    { kind: 'note', id: 4, key: 'after', value: 'after' },
  ];

  const authority = createProtectedAuthority({
    schema,
    nodes,
    delivery:
      mode === 'json' ? { kind: 'json' } : { kind: 'automerge', partitions: createPartitions() },
    users: { owner: 'editable', guest: 'editable', reader: 'read-only' },
    comments: [],
    attachments: [],
    title: () => null,
  });

  authority.setAccess('guest', 'sealed', 'protected');

  function connect(principal: string) {
    const frames: Uint8Array[] = [],
      replies: Uint8Array[] = [];

    const connection = authority.connect(principal, (bytes) => frames.push(bytes.slice()));
    const recipient = createProtectedRecipient(connection.session, createReceivedPartitions());

    const flush = () => {
      const changed = connection.flush();

      if (changed) recipient.receive(frames[frames.length - 1]);

      return changed;
    };

    flush();

    return {
      connection,
      recipient,
      frames,
      replies,
      flush,
      submit(bytes: Uint8Array) {
        const result = connection.submit(bytes);
        replies.push(result.slice());

        return decodeReceipt(result);
      },
      text(key = 'one') {
        return recipient.snapshot().bodies[key]?.text;
      },
      destroy() {
        connection.close();
        recipient.destroy();
      },
    };
  }

  return { authority, connect };
}

const insert = (at: number, text: string, key = 'one') => ({ key, from: at, to: at, text });

for (const mode of ['json', 'automerge'] as const) {
  test(`${mode}: synchronous delivery keeps reentrant views distinct and preserves pending resync`, () => {
    const f = fixture(mode);
    const frames: Uint8Array[] = [];
    const receipts: ReturnType<typeof decodeReceipt>[] = [];

    const connection = f.authority.connect('guest', (bytes) => {
      frames.push(bytes.slice());
      recipient.receive(bytes);

      if (frames.length === 1) {
        receipts.push(decodeReceipt(connection.submit(recipient.propose(insert(0, 'X')))));
        connection.flush();
        connection.resync();
      }
    });

    const recipient = createProtectedRecipient(connection.session, createReceivedPartitions());

    connection.flush();
    expect(receipts).toEqual([{ kind: 'accepted', operation: 1 }]);
    expect(frames.map((bytes) => decodeFrame(bytes).sequence)).toEqual([1, 2]);
    expect(recipient.snapshot().bodies.one?.text).toBe('Xabcd');
    expect(decodeReceipt(connection.submit(recipient.propose(insert(2, 'Y')))).kind).toBe(
      'accepted',
    );
    connection.flush();
    expect(decodeFrame(frames[2]).base).toBeNull();
    expect(recipient.snapshot().bodies.one?.text).toBe('XaYbcd');
    connection.close();
    recipient.destroy();
    f.authority.destroy();
  });

  test(`${mode}: two restricted views edit concurrently across hidden canonical changes`, () => {
    const f = fixture(mode),
      owner = f.connect('owner'),
      guest = f.connect('guest');

    const a = owner.recipient.propose(insert(1, 'A'));
    const b = guest.recipient.propose(insert(1, 'B'));
    const privateEdit = owner.recipient.propose(insert(0, 'PRIVATE_UPDATE', 'PRIVATE_DESCENDANT'));
    expect(owner.submit(privateEdit).kind).toBe('accepted');
    expect(guest.flush()).toBe(false);
    expect(owner.submit(a).kind).toBe('accepted');
    expect(guest.submit(b).kind).toBe('accepted');
    owner.flush();
    guest.flush();
    expect(owner.text()).toBe('aABbcd');
    expect(guest.text()).toBe(owner.text());
    expect(decodeFrame(guest.frames[1]).sequence).toBe(2);
    expect(inspectWire(guest.frames)).not.toContain('PRIVATE_');
    expect(guest.replies.map((bytes) => new TextDecoder().decode(bytes))).toEqual([
      '{"kind":"accepted","operation":1}',
    ]);
    owner.destroy();
    guest.destroy();
    f.authority.destroy();
  });

  test(`${mode}: all 225 replacement pairs converge or return an explicit overlap conflict`, () => {
    let accepted = 0,
      conflicted = 0;

    const reasons = new Set<string>();

    for (const pair of replacementCases()) {
      const f = fixture(mode),
        owner = f.connect('owner'),
        guest = f.connect('guest');

      const a = owner.recipient.propose(pair.first),
        b = guest.recipient.propose(pair.second);

      expect(owner.submit(a).kind).toBe('accepted');
      const outcome = guest.submit(b);

      if (outcome.kind === 'accepted') accepted++;
      else if (outcome.kind === 'rejected') {
        conflicted++;
        reasons.add(outcome.reason);
      } else throw new Error('Invalid fixture proposal');
      owner.flush();
      guest.flush();
      expect(guest.text()).toBe(owner.text());
      expect(JSON.stringify(guest.recipient.snapshot())).not.toContain('PRIVATE_');
      owner.destroy();
      guest.destroy();
      f.authority.destroy();
    }

    expect(accepted).toBe(135);
    expect(conflicted).toBe(90);
    expect([...reasons]).toEqual(['conflict']);
  });

  test(`${mode}: revoked, hidden, missing and read-only targets do not reveal their canonical text`, () => {
    const f = fixture(mode),
      guest = f.connect('guest'),
      reader = f.connect('reader');

    const draft = guest.recipient.propose(insert(0, '!'));
    f.authority.setAccess('guest', 'one', 'read-only');
    expect(guest.submit(draft)).toEqual({ kind: 'rejected', operation: 1, reason: 'denied' });
    const template = decodeProposal(draft);
    const targets = ['sealed', 'PRIVATE_DESCENDANT', 'missing', 'one'];

    const results = targets.map((key, index) =>
      guest.submit(
        encodeProposal({
          ...template,
          operation: index + 2,
          edit: { ...template.edit, key, expected: 'guess' },
        }),
      ),
    );

    expect(
      results.map((result) => (result.kind === 'rejected' ? result.reason : result.kind)),
    ).toEqual(['denied', 'denied', 'denied', 'denied']);
    const readOnlyFrame = decodeFrame(reader.frames[0]);
    expect(
      reader.submit(
        encodeProposal({
          ...template,
          session: reader.connection.session,
          epoch: readOnlyFrame.epoch,
          base: readOnlyFrame.sequence,
        }),
      ),
    ).toEqual({ kind: 'rejected', operation: 1, reason: 'denied' });
    expect(() => reader.recipient.propose(insert(0, '!'))).toThrow('Target not editable');
    guest.flush();
    reader.flush();
    expect(guest.text()).toBe('abcd');
    expect(guest.replies.map((bytes) => new TextDecoder().decode(bytes)).join('\n')).not.toContain(
      'PRIVATE_',
    );
    guest.destroy();
    reader.destroy();
    f.authority.destroy();
  });

  test(`${mode}: retry is idempotent and a regrant cannot resurrect a rejected operation`, () => {
    const f = fixture(mode),
      guest = f.connect('guest');

    const first = guest.recipient.propose(insert(1, '!'));
    expect(guest.submit(first).kind).toBe('accepted');
    expect(guest.submit(first).kind).toBe('accepted');
    const changed = decodeProposal(first);
    expect(
      guest.submit(encodeProposal({ ...changed, edit: { ...changed.edit, text: '?' } })),
    ).toEqual({ kind: 'rejected', operation: 1, reason: 'identity' });
    guest.flush();
    expect(guest.text()).toBe('a!bcd');
    const denied = guest.recipient.propose(insert(0, '?'));
    f.authority.setAccess('guest', 'one', 'read-only');
    const rejection = guest.submit(denied);
    f.authority.setAccess('guest', 'one', 'editable');
    expect(guest.submit(denied)).toEqual(rejection);
    guest.flush();
    expect(guest.submit(guest.recipient.propose(insert(0, '+'))).kind).toBe('accepted');
    guest.flush();
    expect(guest.text()).toBe('+a!bcd');
    guest.destroy();
    f.authority.destroy();
  });

  test(`${mode}: forged sessions, view bases and preconditions are rejected without canonical details`, () => {
    const f = fixture(mode),
      owner = f.connect('owner'),
      guest = f.connect('guest');

    const draft = decodeProposal(guest.recipient.propose(insert(0, '!')));
    expect(owner.submit(encodeProposal(draft))).toEqual({ kind: 'invalid' });
    expect(guest.submit(encodeProposal({ ...draft, base: 9999 }))).toEqual({
      kind: 'rejected',
      operation: 1,
      reason: 'stale',
    });
    expect(
      guest.submit(
        encodeProposal({
          ...draft,
          operation: 2,
          edit: { key: 'one', from: 0, to: 1, expected: 'incorrect', text: 'x' },
        }),
      ),
    ).toEqual({ kind: 'rejected', operation: 2, reason: 'precondition' });
    expect(guest.submit(new TextEncoder().encode('{bad json'))).toEqual({ kind: 'invalid' });
    expect(guest.flush()).toBe(true);
    expect(decodeFrame(guest.frames[1]).writes.receipts).toEqual([
      { kind: 'rejected', operation: 1, reason: 'stale' },
      { kind: 'rejected', operation: 2, reason: 'precondition' },
    ]);
    owner.destroy();
    guest.destroy();
    f.authority.destroy();
  });

  test(`${mode}: native grapheme boundaries are revalidated after concurrent combining-mark insertion`, () => {
    const f = fixture(mode, 'ab'),
      owner = f.connect('owner'),
      guest = f.connect('guest');

    const replacement = guest.recipient.propose({ key: 'one', from: 0, to: 1, text: 'X' });
    expect(owner.submit(owner.recipient.propose(insert(1, '\u0301'))).kind).toBe('accepted');
    expect(guest.submit(replacement)).toEqual({
      kind: 'rejected',
      operation: 1,
      reason: 'precondition',
    });
    guest.flush();
    expect(guest.text()).toBe('a\u0301b');
    guest.destroy();
    owner.destroy();
    f.authority.destroy();
  });

  test(`${mode}: structural changes invalidate old edit bases and a current view can edit again`, () => {
    const f = fixture(mode),
      guest = f.connect('guest');

    const stale = guest.recipient.propose(insert(0, '!'));
    f.authority.apply([
      { kind: 'moveChildren', parent: null, index: 1, count: 1, toParent: null, toIndex: 2 },
    ]);
    expect(guest.submit(stale)).toEqual({ kind: 'rejected', operation: 1, reason: 'stale' });
    guest.flush();
    expect(guest.submit(guest.recipient.propose(insert(0, '!'))).kind).toBe('accepted');
    guest.flush();
    expect(guest.text()).toBe('!abcd');
    expect(inspectWire(guest.frames)).not.toContain('PRIVATE_');
    guest.destroy();
    f.authority.destroy();
  });

  test(`${mode}: delivery gaps block proposals and reconnect rejects old-session edits`, () => {
    const f = fixture(mode),
      guest = f.connect('guest');

    const draft = guest.recipient.propose(insert(0, '!'));
    guest.destroy();
    const reopened = f.connect('guest');
    expect(reopened.submit(draft)).toEqual({ kind: 'invalid' });
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'A' }]);
    reopened.connection.flush();
    f.authority.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'B' }]);
    reopened.connection.flush();
    expect(reopened.recipient.receive(reopened.frames[2])).toBe(false);
    expect(() => reopened.recipient.propose(insert(0, '!'))).toThrow('Recipient not ready');
    reopened.connection.resync();
    reopened.flush();
    expect(reopened.submit(reopened.recipient.propose(insert(0, '!'))).kind).toBe('accepted');
    reopened.flush();
    expect(reopened.text()).toBe('!BAabcd');
    reopened.destroy();
    f.authority.destroy();
  });
}

test('an uncertain delivery closes its session rather than reusing a view sequence for new content', () => {
  const f = fixture('json');
  const frames: Uint8Array[] = [];

  const connection = f.authority.connect('guest', (bytes) => {
    frames.push(bytes.slice());
    throw new Error('Delivery failed');
  });

  expect(() => connection.flush()).toThrow('Delivery failed');
  const replica = createProtectedRecipient(connection.session, createReceivedPartitions());
  replica.receive(frames[0]);
  const proposal = replica.propose(insert(0, '!'));
  expect(() => connection.submit(proposal)).toThrow('Session closed');
  expect(() => connection.flush()).toThrow('Session closed');
  const reopened = f.connect('guest');
  expect(reopened.submit(proposal)).toEqual({ kind: 'invalid' });
  expect(reopened.submit(reopened.recipient.propose(insert(0, '?'))).kind).toBe('accepted');
  reopened.flush();
  expect(reopened.text()).toBe('?abcd');
  replica.destroy();
  reopened.destroy();
  f.authority.destroy();
});
