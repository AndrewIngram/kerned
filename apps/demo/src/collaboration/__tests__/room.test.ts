import { textSelection, TextSelection } from '@kerned/state';
import { decorations } from '@kerned/view';
import { expect, test, onTestFinished as registerCleanup } from 'vitest';

import { createCollaborationRoom } from '../room.js';

function fixture() {
  const room = createCollaborationRoom();
  const [alice, bob] = room.clients;

  function text(client: typeof alice, key = 'intro') {
    const node = client.editor.state.nodes.find((node) => node.key === key);

    return node ? client.editor.schema.text(node) : null;
  }

  function insert(client: typeof alice, offset: number, value: string) {
    client.editor.select(textSelection(2, offset));
    client.editor.transact((context) => {
      context.steps([{ kind: 'replaceText', id: 2, from: offset, to: offset, text: value }]);

      return true;
    });
  }

  return { room, alice, bob, text, insert };
}

test('independent sessions converge after paused concurrent typing without exposing private text', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.room.destroy());
  await Promise.resolve();
  expect(f.alice.editor).not.toBe(f.bob.editor);
  expect(f.text(f.alice, 'private')).toContain('MARIGOLD');
  expect(JSON.stringify(f.bob.editor.state)).not.toContain('MARIGOLD');
  expect(f.bob.editor.getAccess(4)).toBe('protected');
  const original = f.text(f.alice);
  f.room.toggleDelivery();
  f.insert(f.alice, 0, 'Alice: ');
  f.insert(f.bob, 0, 'Bob: ');
  await Promise.resolve();
  expect(f.text(f.alice)).toBe(`Alice: ${original}`);
  expect(f.text(f.bob)).toBe(`Bob: ${original}`);
  expect(f.room.getSnapshot().pending).toBe(2);
  f.room.toggleDelivery();
  await Promise.resolve();
  expect(f.text(f.alice)).toBe(f.text(f.bob));
  expect(f.text(f.alice)).toBe(`Alice: Bob: ${original}`);
  expect(f.room.getSnapshot().pending).toBe(0);
  expect(f.alice.editor.state.selection).toBeInstanceOf(TextSelection);
});

test('unsupported mutations abort before editor state or pending requests change', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.room.destroy());
  await Promise.resolve();
  const before = f.alice.editor.state;
  expect(f.alice.editor.commands.splitBlock()).toBe(false);
  expect(f.alice.editor.state).toBe(before);
  expect(() => f.alice.editor.commands.toggleFormat('bold')).toThrow(/existing blocks/);
  expect(f.alice.editor.state).toBe(before);
  expect(f.room.getSnapshot().pending).toBe(0);
  f.insert(f.alice, 0, 'A');
  await Promise.resolve();
  expect(() => f.alice.editor.commands.undo()).toThrow(/not synchronized/);
  expect(f.text(f.alice)).toBe(f.text(f.bob));
});

test('overlapping replacements report a conflict and remain editable afterwards', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.room.destroy());
  await Promise.resolve();
  f.room.toggleDelivery();

  for (const client of [f.alice, f.bob])
    client.editor.transact((context) => {
      context.steps([{ kind: 'replaceText', id: 2, from: 0, to: 4, text: client.profile.name }]);

      return true;
    });
  f.room.toggleDelivery();
  await Promise.resolve();
  expect(f.room.getSnapshot().message).toContain('conflicted');
  expect(f.text(f.alice)).toBe(f.text(f.bob));
  f.insert(f.bob, 0, 'Again ');
  await Promise.resolve();
  expect(f.text(f.alice)).toBe(f.text(f.bob));
});

test('destroying a room cancels scheduled delivery and permits a fresh room', async () => {
  const f = fixture();
  f.insert(f.alice, 0, 'Discard');
  f.room.destroy();
  f.room.destroy();
  await Promise.resolve();
  expect(f.alice.editor.isDestroyed).toBe(true);
  expect(f.bob.editor.isDestroyed).toBe(true);
  const next = fixture();
  await Promise.resolve();
  expect(next.text(next.alice)).not.toContain('Discard');
  next.room.destroy();
});

test('confirmation publishes a caret inside previously unconfirmed inserted text without another interaction', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.room.destroy());
  await Promise.resolve();
  f.room.toggleDelivery();
  f.insert(f.alice, 0, 'XYZ');
  f.alice.editor.select(textSelection(2, 1));
  f.room.toggleDelivery();
  await Promise.resolve();
  const provider = decorations.read(f.bob.editor).find((value) => value.name === 'remotePresence');

  if (!provider) throw new Error('Missing presence contribution');
  const source = provider.create(f.bob.editor);
  onTestFinished(() => source.destroy?.());
  expect(
    source.read(2, f.bob.editor.state).filter((value) => value.kind === 'widget'),
  ).toMatchObject([{ at: { kind: 'text', offset: 1 } }]);
  expect(f.room.getSnapshot().pending).toBe(0);
});

test.each([0, 1])(
  'client %i publishes selection-only updates without document transactions',
  async (senderIndex) => {
    const f = fixture();
    registerCleanup(() => f.room.destroy());
    await Promise.resolve();
    const peers = [f.alice, f.bob];
    const before = peers.map((peer) => peer.editor.state);
    let edits = 0;

    for (const peer of peers)
      peer.editor.on('content', () => {
        edits++;
      });

    const sender = peers[senderIndex];
    const receiver = peers[1 - senderIndex];

    const provider = decorations
      .read(receiver.editor)
      .find((value) => value.name === 'remotePresence');

    if (!provider) throw new Error('Missing presence contribution');
    const source = provider.create(receiver.editor);
    registerCleanup(() => source.destroy?.());
    sender.editor.select(textSelection(2, 3, 8));
    await Promise.resolve();
    expect(
      source.read(2, receiver.editor.state).filter((value) => value.kind === 'text'),
    ).toMatchObject([{ from: 3, to: 8 }]);
    sender.editor.select(textSelection(2, 12));
    await Promise.resolve();
    expect(source.read(2, receiver.editor.state).filter((value) => value.kind === 'text')).toEqual(
      [],
    );
    expect(
      source.read(2, receiver.editor.state).filter((value) => value.kind === 'widget'),
    ).toMatchObject([{ at: { kind: 'text', offset: 12 } }]);

    expect(edits).toBe(0);
    expect(f.room.getSnapshot().pending).toBe(0);

    for (const [index, peer] of peers.entries()) {
      expect(peer.editor.state.nodes).toBe(before[index].nodes);
      expect(peer.editor.state.revision).toBe(before[index].revision);
    }
  },
);
