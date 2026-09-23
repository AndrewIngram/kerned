import { createSchema, defineNode } from '@kerned/model';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createProtectedAuthority } from '../protected/authority.js';
import { createOptimisticRecipient } from '../protected/optimistic.js';
import { decodeProposal, encodeProposal } from '../protected/wire.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.object({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const schema = createSchema({ extensions: [note] });

const caret = (offset: number) => ({
  anchor: { key: 'one', offset, association: 1 as const },
  head: { key: 'one', offset, association: 1 as const },
});

function fixture() {
  const authority = createProtectedAuthority({
    schema,
    delivery: { kind: 'json' },
    nodes: [schema.node(note).create({ id: 1, key: 'one' }, { text: '_' })],
    users: { alice: 'editable', bob: 'editable', cara: 'editable' },
    comments: [],
    attachments: [],
    title: () => null,
  });

  const peers = ['alice', 'bob', 'cara'].map((name) => {
    const frames: Uint8Array[] = [];
    const connection = authority.connect(name, (bytes) => frames.push(bytes));
    const client = createOptimisticRecipient(connection.session);
    connection.flush();

    for (const bytes of frames.splice(0)) client.receive(bytes);
    client.select(caret(0));

    return { client, connection, frames };
  });

  function type(index: number, text: string) {
    const client = peers[index].client;

    for (const character of text) {
      const at = client.selection?.head.offset;

      if (at === undefined) throw new Error('Missing caret');
      client.edit({ key: 'one', from: at, to: at, text: character }, { typing: true });
      client.select(caret(at + character.length));
    }
  }

  function send(index: number) {
    const peer = peers[index];
    const bytes = peer.client.request();

    if (bytes) peer.connection.submit(bytes);

    return bytes;
  }

  function deliver() {
    for (const peer of peers) {
      peer.connection.flush();

      for (const bytes of peer.frames.splice(0)) peer.client.receive(bytes);
    }
  }

  function drain(order = [0, 1, 2]) {
    for (let i = 0; i < 100 && peers.some((peer) => peer.client.pending); i++) {
      for (const index of order) send(index);
      deliver();
    }

    expect(peers.map((peer) => peer.client.pending)).toEqual([0, 0, 0]);
  }

  return {
    authority,
    peers,
    type,
    send,
    deliver,
    drain,
    texts: () => peers.map((peer) => peer.client.text('one')),
    destroy() {
      for (const peer of peers) peer.client.destroy();
      authority.destroy();
    },
  };
}

for (const order of [
  [0, 1, 2],
  [2, 1, 0],
])
  test(`buffered runs stay whole in delivery order ${order.join(',')}`, ({ onTestFinished }) => {
    const f = fixture();
    onTestFinished(() => f.destroy());
    f.type(0, 'Alice');
    f.type(1, 'Bob');
    f.type(2, 'Cara');
    f.drain(order);
    expect(f.texts()).toEqual(
      Array(3).fill(order.map((index) => ['Alice', 'Bob', 'Cara'][index]).join('') + '_'),
    );
  });

test('runs continue through acknowledgements and competing insertions at their trailing edge', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.type(0, 'A');
  f.type(1, 'B');
  f.send(0);
  f.send(1);
  f.deliver();
  expect(f.peers[0].client.selection?.head.offset).toBe(1);
  f.type(0, 'lice');
  f.type(1, 'ob');
  f.drain();
  expect(f.texts()).toEqual(['AliceBob_', 'AliceBob_', 'AliceBob_']);
});

test('an in-flight request stays immutable while its run continues', ({ onTestFinished }) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.type(0, 'A');
  const bytes = f.send(0);
  f.type(0, 'lice');
  f.type(1, 'Bob');
  expect(f.peers[0].client.request()).toEqual(bytes);
  f.send(1);
  f.deliver();
  f.drain();
  expect(f.texts()).toEqual(['AliceBob_', 'AliceBob_', 'AliceBob_']);
});

test('Unicode continuations preserve runs and valid grapheme boundaries', ({ onTestFinished }) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.type(0, 'a\u0301🙂');
  f.type(1, '界語');
  f.drain();
  expect(f.texts()).toEqual(['a\u0301🙂界語_', 'a\u0301🙂界語_', 'a\u0301🙂界語_']);
});

test('the authority rejects invented continuations and altered retry identities', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.type(0, 'A');
  const bytes = f.peers[0].client.request();

  if (!bytes) throw new Error('Missing request');
  const proposal = decodeProposal(bytes);

  const forged = encodeProposal({
    ...proposal,
    edit: { ...proposal.edit, run: { id: 'invented', offset: 4 } },
  });

  expect(JSON.parse(new TextDecoder().decode(f.peers[0].connection.submit(forged)))).toMatchObject({
    kind: 'rejected',
    reason: 'precondition',
  });
  expect(JSON.parse(new TextDecoder().decode(f.peers[0].connection.submit(bytes)))).toMatchObject({
    kind: 'rejected',
    reason: 'identity',
  });
});

test('explicit cursor movement starts a new run at the chosen location', ({ onTestFinished }) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.type(0, 'Alice');
  f.drain();
  const client = f.peers[0].client;
  client.breakTyping();
  client.select(caret(0));
  f.type(0, 'New ');
  f.drain();
  expect(f.texts()).toEqual(['New Alice_', 'New Alice_', 'New Alice_']);
});
