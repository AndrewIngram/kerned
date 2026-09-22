import * as Automerge from '@automerge/automerge';
import { expect, test } from 'vitest';

import { createProtectedAuthority } from '../packages/collaboration-lab/src/protected/authority.js';
import {
  createPartitions,
  createReceivedPartitions,
} from '../packages/collaboration-lab/src/protected/partitions.js';
import { createProtectedRecipient } from '../packages/collaboration-lab/src/protected/recipient.js';
import {
  decodeFrame,
  encodeFrame,
  encodePresence,
} from '../packages/collaboration-lab/src/protected/wire.js';
import type { PresenceSelection } from '../packages/collaboration-lab/src/protocol.js';
import { schema, type Node } from './experiments/collaboration/fixtures.js';
import { inspectWire } from './experiments/collaboration/protected/audit.js';

const secret = 'PRIVATE_TEXT_SENTINEL';

const hiddenKey = 'PRIVATE_DESCENDANT_KEY';

const fileSecret = 'PRIVATE_ATTACHMENT_SENTINEL';

function fixture(mode: 'json' | 'automerge') {
  const nodes: Node[] = [
    { kind: 'note', id: 1, key: 'before', value: 'Public introduction' },
    {
      kind: 'group',
      id: 20,
      key: 'sealed',
      children: [
        { kind: 'note', id: 21, key: hiddenKey, value: secret },
        {
          kind: 'group',
          id: 22,
          key: 'PRIVATE_NESTED_KEY',
          children: [
            { kind: 'note', id: 23, key: 'PRIVATE_LEAF_KEY', value: 'PRIVATE_NESTED_CONTENT' },
          ],
        },
      ],
    },
    { kind: 'note', id: 30, key: 'after', value: 'Public conclusion' },
  ];

  const host = createProtectedAuthority({
    schema,
    nodes,
    delivery:
      mode === 'json' ? { kind: 'json' } : { kind: 'automerge', partitions: createPartitions() },
    users: { owner: 'editable', guest: 'editable', reader: 'read-only' },
    comments: [
      { id: 'comment-public', from: 'before', to: 'before', text: 'Visible comment', readKeys: [] },
      {
        id: 'comment-private',
        from: hiddenKey,
        to: hiddenKey,
        text: 'PRIVATE_COMMENT_SENTINEL',
        readKeys: [hiddenKey],
      },
      {
        id: 'comment-crossing',
        from: 'before',
        to: 'after',
        text: 'PRIVATE_CROSSING_COMMENT',
        readKeys: [hiddenKey],
      },
    ],
    attachments: [
      { id: 'attachment-private', key: hiddenKey, body: fileSecret },
      { id: 'attachment-public', key: 'before', body: 'Public attachment' },
    ],
    title: (node) => schema.text(node),
  });

  host.setAccess('guest', 'sealed', 'protected');

  function connect(principal: string) {
    const frames: Uint8Array[] = [];
    const connection = host.connect(principal, (bytes) => frames.push(bytes.slice()));
    const recipient = createProtectedRecipient(connection.session, createReceivedPartitions());
    let presenceSequence = 0;

    return {
      connection,
      recipient,
      frames,
      presence(selection: PresenceSelection | null) {
        const view = decodeFrame(frames[frames.length - 1]);

        return connection.presence(
          encodePresence({
            session: connection.session,
            epoch: view.epoch,
            base: view.sequence,
            sequence: ++presenceSequence,
            selection,
          }),
        );
      },
      flush() {
        const sent = connection.flush();

        if (sent) recipient.receive(frames[frames.length - 1]);

        return sent;
      },
      destroy() {
        connection.close();
        recipient.destroy();
      },
    };
  }

  return { host, connect };
}

const caret = (key: string, offset: number) => ({
  anchor: { key, offset, association: 1 as const },
  head: { key, offset, association: 1 as const },
});

for (const mode of ['json', 'automerge'] as const) {
  test(`${mode}: initial protected subtree never reaches wire, search, outline, comments or attachment cache`, () => {
    const f = fixture(mode),
      guest = f.connect('guest'),
      owner = f.connect('owner'),
      reader = f.connect('reader');

    owner.flush();
    owner.presence(caret(hiddenKey, 1));
    guest.connection.requestAttachment('attachment-private');
    guest.connection.requestAttachment('missing');
    guest.connection.requestAttachment('attachment-public');
    expect(guest.flush()).toBe(true);
    owner.flush();
    reader.flush();
    const snapshot = guest.recipient.snapshot();
    expect(snapshot.manifest).toEqual([
      { kind: 'visible', key: 'before', parent: null, access: 'editable' },
      { kind: 'protected', key: 'sealed', parent: null, locked: false },
      { kind: 'visible', key: 'after', parent: null, access: 'editable' },
    ]);
    expect(snapshot.comments.map((item) => item.id)).toEqual(['comment-public']);
    expect(snapshot.presence).toEqual([]);
    expect(snapshot.outline.map((item) => item.key)).toEqual(['before', 'after']);
    expect(snapshot.attachments).toEqual({
      'attachment-public': { key: 'before', body: 'Public attachment' },
    });
    expect(guest.recipient.search('PRIVATE')).toEqual([]);
    expect(guest.recipient.search('Public')).toHaveLength(2);
    expect(inspectWire(guest.frames)).not.toContain('PRIVATE_');
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_');
    expect(owner.recipient.search(secret)).toHaveLength(1);
    expect(
      reader.recipient
        .snapshot()
        .manifest.every((item) => item.kind === 'visible' && item.access === 'read-only'),
    ).toBe(true);
    expect(decodeFrame(guest.frames[0]).attachments.slice(0, 2)).toEqual([
      { id: 'attachment-private', status: 'unavailable' },
      { id: 'missing', status: 'unavailable' },
    ]);
    guest.destroy();
    owner.destroy();
    reader.destroy();
    f.host.destroy();
  });

  test(`${mode}: hidden edits produce no recipient update, while visible edits still replicate`, () => {
    const f = fixture(mode),
      guest = f.connect('guest'),
      owner = f.connect('owner');

    guest.flush();
    owner.flush();
    f.host.apply([
      { kind: 'replaceText', id: 21, from: 0, to: secret.length, text: 'PRIVATE_NEW_VERSION' },
    ]);
    expect(guest.flush()).toBe(false);
    expect(owner.flush()).toBe(true);
    f.host.apply([{ kind: 'replaceText', id: 30, from: 0, to: 0, text: 'Updated ' }]);
    expect(guest.flush()).toBe(true);
    expect(guest.recipient.search('Updated')).toEqual([
      { key: 'after', text: 'Updated Public conclusion' },
    ]);
    expect(decodeFrame(guest.frames[1]).updates.map((update) => update.key)).toEqual(['after']);
    expect(inspectWire(guest.frames)).not.toContain('PRIVATE_');
    guest.destroy();
    owner.destroy();
    f.host.destroy();
  });

  test(`${mode}: revocation cancels queued reads, purges caches and ignores older delivered frames`, () => {
    const f = fixture(mode);
    f.host.setAccess('guest', 'sealed', 'editable');
    const guest = f.connect('guest');
    guest.connection.requestAttachment('attachment-private');
    guest.flush();
    const oldFrame = guest.frames[0];
    expect(guest.recipient.search(secret)).toHaveLength(1);
    expect(guest.recipient.snapshot().attachments['attachment-private'].body).toBe(fileSecret);
    guest.connection.requestAttachment('attachment-private');
    f.host.apply([
      { kind: 'replaceText', id: 21, from: 0, to: secret.length, text: 'PRIVATE_UNSENT_VERSION' },
    ]);
    f.host.setAccess('guest', 'sealed', 'protected');
    guest.flush();
    const revokedFrame = guest.frames[1];
    expect(inspectWire([revokedFrame])).not.toContain('PRIVATE_');
    expect(guest.recipient.snapshot().attachments).toEqual({});
    expect(guest.recipient.search('PRIVATE')).toEqual([]);
    expect(guest.recipient.receive(oldFrame)).toBe(false);
    expect(JSON.stringify(guest.recipient.snapshot())).not.toContain('PRIVATE_');
    guest.destroy();
    f.host.destroy();
  });

  test(`${mode}: a newly granted reader receives current content without protected-period history`, () => {
    const f = fixture(mode),
      owner = f.connect('owner'),
      guest = f.connect('guest');

    owner.flush();
    guest.flush();
    f.host.apply([
      {
        kind: 'replaceText',
        id: 21,
        from: 0,
        to: secret.length,
        text: 'HISTORICAL_DENIED_VERSION',
      },
    ]);
    owner.flush();
    f.host.apply([
      {
        kind: 'replaceText',
        id: 21,
        from: 0,
        to: 'HISTORICAL_DENIED_VERSION'.length,
        text: 'Now approved',
      },
    ]);
    owner.flush();
    f.host.setAccess('guest', 'sealed', 'read-only');
    guest.flush();
    const wire = inspectWire(guest.frames);
    expect(wire).not.toContain('HISTORICAL_DENIED_VERSION');
    expect(wire).not.toContain(secret);
    expect(guest.recipient.search('Now approved')).toHaveLength(1);
    expect(
      guest.recipient.snapshot().manifest.find((item) => item.key === hiddenKey),
    ).toMatchObject({ access: 'read-only' });
    guest.destroy();
    owner.destroy();
    f.host.destroy();
  });

  test(`${mode}: reconnect cannot request old private history or revive an old session`, () => {
    const f = fixture(mode),
      guest = f.connect('guest');

    guest.flush();
    const old = guest.frames[0];
    guest.destroy();
    const reopened = f.connect('guest');
    reopened.connection.requestAttachment('attachment-private');
    reopened.flush();
    expect(reopened.recipient.receive(old)).toBe(false);
    expect(inspectWire(reopened.frames)).not.toContain('PRIVATE_');
    expect(() => guest.connection.flush()).toThrow('Session closed');
    reopened.destroy();
    f.host.destroy();
  });

  test(`${mode}: presence spanning protected content is omitted before serialization`, () => {
    const f = fixture(mode),
      owner = f.connect('owner'),
      guest = f.connect('guest');

    owner.flush();
    expect(
      owner.presence({
        anchor: caret('before', 0).anchor,
        head: caret('after', 3).head,
      }),
    ).toBe(true);
    guest.flush();
    expect(decodeFrame(guest.frames[0]).presence).toEqual([]);
    expect(guest.presence(caret(hiddenKey, 1))).toBe(false);
    expect(owner.presence(caret('before', 2))).toBe(true);
    guest.flush();
    expect(guest.recipient.snapshot().presence).toEqual([
      { session: owner.connection.session, selection: caret('before', 2) },
    ]);
    owner.destroy();
    guest.flush();
    expect(guest.recipient.snapshot().presence).toEqual([]);
    guest.destroy();
    f.host.destroy();
  });

  test(`${mode}: delivery gaps clear the replica and require a current authorized resync`, () => {
    const f = fixture(mode),
      guest = f.connect('guest');

    guest.flush();
    f.host.apply([{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'A' }]);
    guest.connection.flush();
    f.host.apply([{ kind: 'replaceText', id: 30, from: 0, to: 0, text: 'B' }]);
    guest.connection.flush();
    expect(guest.recipient.receive(guest.frames[2])).toBe(false);
    expect(guest.recipient.status).toBe('resync');
    expect(guest.recipient.snapshot().bodies).toEqual({});
    guest.connection.resync();
    guest.flush();
    expect(guest.recipient.status).toBe('ready');
    expect(guest.recipient.search('APublic')).toHaveLength(1);
    expect(guest.recipient.receive(guest.frames[1])).toBe(false);
    expect(inspectWire(guest.frames)).not.toContain('PRIVATE_');
    guest.destroy();
    f.host.destroy();
  });

  test(`${mode}: canonical moves preserve the opaque block identity without revealing its descendants`, () => {
    const f = fixture(mode),
      guest = f.connect('guest');

    guest.flush();
    f.host.apply([
      { kind: 'moveChildren', parent: null, index: 1, count: 1, toParent: null, toIndex: 2 },
    ]);
    guest.flush();
    expect(guest.recipient.snapshot().manifest.map((item) => item.key)).toEqual([
      'before',
      'after',
      'sealed',
    ]);
    expect(inspectWire(guest.frames)).not.toContain('PRIVATE_');
    guest.destroy();
    f.host.destroy();
  });
}

test('wire audit detects hidden native history even when current materialized content is public', () => {
  let doc = Automerge.from({ body: { type: 'note', data: { value: secret }, text: secret } });
  doc = Automerge.change(doc, (draft) => {
    draft.body.data.value = 'Public';
    draft.body.text = 'Public';
  });

  const frame = encodeFrame({
    session: 'audit',
    epoch: 1,
    sequence: 1,
    base: null,
    manifest: [{ kind: 'visible', key: 'one', parent: null, access: 'read-only' }],
    updates: [
      { kind: 'automerge', key: 'one', mode: 'snapshot', bytes: [Array.from(Automerge.save(doc))] },
    ],
    comments: [],
    outline: [],
    presence: [],
    attachments: [],
    writes: { changes: [], receipts: [] },
  });

  expect(JSON.stringify(doc)).not.toContain(secret);
  expect(new TextDecoder().decode(frame)).not.toContain(secret);
  expect(inspectWire([frame])).toContain(secret);
  Automerge.free(doc);
});

test('Automerge access epochs remove old history but replace native reference identities', () => {
  const f = fixture('automerge'),
    owner = f.connect('owner');

  owner.flush();
  const before = decodeFrame(owner.frames[0]).updates.find((update) => update.key === hiddenKey);

  if (before?.kind !== 'automerge') throw new Error('Missing native partition');
  const original = Automerge.load(new Uint8Array(before.bytes[0]));
  const heads = Automerge.getHeads(original);
  f.host.setAccess('guest', 'sealed', 'read-only');
  owner.flush();
  const after = decodeFrame(owner.frames[1]).updates.find((update) => update.key === hiddenKey);

  if (after?.kind !== 'automerge') throw new Error('Missing native partition');
  const replacement = Automerge.load(new Uint8Array(after.bytes[0]));
  expect(Automerge.hasHeads(replacement, heads)).toBe(false);
  expect(owner.recipient.search(secret)).toHaveLength(1);
  Automerge.free(original);
  Automerge.free(replacement);
  owner.destroy();
  f.host.destroy();
});
