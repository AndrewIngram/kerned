import { textSelection, TextSelection } from '@gprose/state';
import { expect, test } from 'vitest';

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
