import { createEditor } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { textSelection, NodeSelection } from '@gprose/state';
import { expect, test } from 'vitest';

import { mountEditor } from '../../editor-canvas';
import { createCommentStore, captureComment } from '../comment';
import { createCommentProjection } from '../comment-projection';
import { commentView, onCommentActivate, type CommentActivation } from '../comment-view';
import { starterBrowserExtensions } from '../starter-kit/browser';

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

test('external comments repaint without transactions and survive edits, undo and remount', async ({
  onTestFinished,
}) => {
  const comments = createCommentStore<string>();
  let subscriptions = 0;

  const source = {
    get state() {
      return comments.state;
    },
    subscribe(listener: () => void) {
      subscriptions++;
      const stop = comments.subscribe(listener);

      return () => {
        subscriptions--;
        stop();
      };
    },
  };

  const editor = createEditor({
    schema: createSchema({ extensions: [commentView(source), ...starterBrowserExtensions()] }),
    content: [
      {
        kind: 'paragraph',
        id: 1,
        text: 'A comment can span several wrapped lines and include new words within its range. '.repeat(
          3,
        ),
      },
      {
        kind: 'image',
        id: 2,
        src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"/>',
        alt: 'Illustration',
      },
    ],
    selection: textSelection(1, 0),
  });

  const host = document.createElement('div');
  host.style.cssText = 'width:360px;height:500px;';
  document.body.append(host);
  let view = mountEditor(host, { editor });
  onTestFinished(() => {
    view.destroy();
    editor.destroy();
    host.remove();
  });
  const activated: CommentActivation[] = [];
  onCommentActivate(editor, (value) => activated.push(value));
  await view.ready;
  expect(subscriptions).toBe(1);
  const before = editor.state;
  let transactions = 0;
  editor.on('transaction', () => {
    transactions++;
  });
  comments.put({
    id: 'thread',
    messages: ['Discussion'],
    range: editor.positions.range(editor.positions.at(1, 0, 1), editor.positions.at(1, 80, -1)),
  });
  await expect.poll(() => host.querySelectorAll('[data-comment-hit]').length).toBeGreaterThan(1);
  expect(editor.state).toBe(before);
  expect(transactions).toBe(0);
  const button = host.querySelector<HTMLButtonElement>('[data-comment-hit]');

  if (!button) throw new Error('Missing comment');
  button.click();
  expect(activated.at(-1)).toMatchObject({ id: 'thread', nodeId: 1, focus: 'panel' });
  const caret = view.coordsAt({ id: 1, offset: 20 });

  if (!caret) throw new Error('Missing caret geometry');
  button.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
      clientX: caret.left + 0.1,
      clientY: (caret.top + caret.bottom) / 2,
    }),
  );
  button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  expect(editor.state.selection).toMatchObject({ head: { id: 1, offset: 20 } });
  expect(activated.at(-1)).toMatchObject({ id: 'thread', nodeId: 1, index: 20, focus: 'text' });
  editor.select(textSelection(1, 5));
  editor.commands.focus();
  const input = host.querySelector('textarea');

  if (!input) throw new Error('Missing input');
  input.setRangeText('++', input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '++' }),
  );
  const project = createCommentProjection(editor, comments);
  expect(project().text.get(1)?.[0]).toMatchObject({ from: 0, to: 82 });
  editor.commands.undo();
  expect(project().text.get(1)?.[0]).toMatchObject({ from: 0, to: 80 });
  editor.select(new NodeSelection(2));
  const imageThread = captureComment(editor, 'image-thread', ['Image']);

  if (!imageThread) throw new Error('Cannot capture image range');
  comments.put(imageThread);
  await expect.poll(() => host.querySelector('[data-commented-node="2"]')).not.toBeNull();
  host
    .querySelector<HTMLElement>('[data-image="2"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  expect(activated.at(-1)).toMatchObject({ id: 'image-thread', nodeId: 2 });
  view.destroy();
  expect(subscriptions).toBe(0);
  comments.remove('thread');
  await frame();
  expect(host.children).toHaveLength(0);
  view = mountEditor(host, { editor });
  await view.ready;
  expect(subscriptions).toBe(1);
  expect(host.querySelectorAll('[data-comment-hit]')).toHaveLength(0);
  await expect.poll(() => host.querySelector('[data-commented-node="2"]')).not.toBeNull();
  comments.remove('image-thread');
  await expect.poll(() => host.querySelector('[data-commented-node="2"]')).toBeNull();
});
