import { textSelection } from '@kerned/state';
import { mountEditor, decorations } from '@kerned/view';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { createCollaborationRoom } from '../room.js';

test('mounted peers type, rebase delayed edits, render selections and guard unsupported shortcuts', async ({
  onTestFinished,
}) => {
  const room = createCollaborationRoom();

  const peers = room.clients.map((client) => {
    const host = document.createElement('div');
    host.style.cssText = 'width:620px;height:650px;position:relative';
    document.body.append(host);
    const notices: string[] = [];

    const view = mountEditor(host, {
      editor: client.editor,
      scroll: 'container',
      paddingTop: 30,
      onNotice: (message) => notices.push(message),
    });

    return { ...client, host, view, notices };
  });

  onTestFinished(() => {
    for (const peer of peers) {
      peer.view.destroy();
      peer.host.remove();
    }

    room.destroy();
  });
  await Promise.all(peers.map((peer) => peer.view.ready));
  const [alice, bob] = peers;
  const aliceInput = alice.host.querySelector('textarea');
  const bobInput = bob.host.querySelector('textarea');

  if (!aliceInput || !bobInput) throw new Error('Missing editor input');
  const text = (peer: typeof alice) => peer.editor.schema.text(peer.editor.state.nodes[1]);
  const original = text(alice);
  alice.editor.select(textSelection(2, 5, 10));
  const provider = decorations.read(bob.editor).find((value) => value.name === 'remotePresence');

  if (!provider) throw new Error('Missing presence contribution');
  const source = provider.create(bob.editor);
  onTestFinished(() => source.destroy?.());
  await expect
    .poll(() => source.read(2, bob.editor.state).filter((value) => value.kind === 'text'))
    .toMatchObject([{ from: 5, to: 10 }]);
  expect(bob.view.status).toBe('ready');
  await expect.poll(() => bob.host.querySelector('[data-remote-caret]')).not.toBeNull();
  const caret = bob.host.querySelector<HTMLElement>('[data-remote-caret]');

  if (!caret) throw new Error('Missing remote caret');
  await expect
    .poll(() =>
      Math.abs(
        caret.getBoundingClientRect().left - (bob.view.coordsAt({ id: 2, offset: 10 })?.left ?? 0),
      ),
    )
    .toBeLessThan(1);
  expect(bob.host.querySelector('[data-protected-content]')?.textContent).toBe('Protected content');
  expect(bob.host.innerHTML).not.toContain('MARIGOLD');
  const beforeMovement = peers.map((peer) => peer.editor.state.nodes);
  aliceInput.focus();
  await userEvent.keyboard('{ArrowRight}{ArrowRight}{Shift>}{ArrowRight}{/Shift}');
  await expect
    .poll(() => source.read(2, bob.editor.state).filter((value) => value.kind === 'text'))
    .toMatchObject([{ from: 11, to: 12 }]);
  await expect
    .poll(() =>
      Math.abs(
        caret.getBoundingClientRect().left - (bob.view.coordsAt({ id: 2, offset: 12 })?.left ?? 0),
      ),
    )
    .toBeLessThan(1);

  for (const [index, peer] of peers.entries())
    expect(peer.editor.state.nodes).toBe(beforeMovement[index]);
  expect(room.getSnapshot().pending).toBe(0);

  room.toggleDelivery();
  alice.editor.select(textSelection(2, 0));
  aliceInput.focus();
  await userEvent.keyboard('Alice ');
  bob.editor.select(textSelection(2, original?.length ?? 0));
  bobInput.focus();
  await userEvent.keyboard('Bob ');
  expect(text(alice)).toBe(`Alice ${original}`);
  expect(text(bob)).toBe(`${original}Bob `);
  room.toggleDelivery();
  await expect.poll(() => text(bob)).toBe(`Alice ${original}Bob `);
  expect(text(alice)).toBe(text(bob));
  await expect.poll(() => room.getSnapshot().pending).toBe(0);
  const before = text(bob);
  await userEvent.keyboard('{Control>}b{/Control}');
  expect(bob.notices.join(' ')).toContain('not synchronized');
  expect(text(bob)).toBe(before);
  await userEvent.keyboard('{Enter}');
  expect(bob.editor.state.nodes).toHaveLength(5);
  bob.editor.select(textSelection(4, 0));
  await userEvent.keyboard('forbidden');
  expect(JSON.stringify(bob.editor.state)).not.toContain('forbidden');
  expect(alice.editor.schema.text(alice.editor.state.nodes[3])).toContain('MARIGOLD');
  bob.editor.select(textSelection(2, 0));
  await userEvent.keyboard('!');
  await expect.poll(() => text(alice)).toBe(`!${before}`);
  room.toggleDelivery();
  alice.editor.select(textSelection(2, 0));
  aliceInput.focus();
  await userEvent.keyboard('XYZ');
  alice.editor.select(textSelection(2, 1));
  room.toggleDelivery();
  await expect.poll(() => room.getSnapshot().pending).toBe(0);
  await expect
    .poll(() =>
      Math.abs(
        caret.getBoundingClientRect().left - (bob.view.coordsAt({ id: 2, offset: 1 })?.left ?? 0),
      ),
    )
    .toBeLessThan(1);
  expect(bob.view.status).toBe('ready');
});
