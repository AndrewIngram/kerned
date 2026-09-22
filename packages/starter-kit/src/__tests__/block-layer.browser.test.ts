import { createEditor } from '@gprose/core';
import { createCommentStore } from '@gprose/extension-comments';
import { commentView, onCommentActivate } from '@gprose/extension-comments/browser';
import { onMentionActivate } from '@gprose/extension-document/browser';
import { searchView } from '@gprose/extension-search';
import { createSchema } from '@gprose/model';
import { EditorContent } from '@gprose/react';
import { textSelection } from '@gprose/state';
import { mountEditor, type MountedEditor } from '@gprose/view';
import { createViewDiagnostics } from '@gprose/view/diagnostics';
import { createElement, StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';

import { createDemoDocumentQuery } from '../../../../src/demo/document-query.js';
import { createSampleDocument } from '../../../../src/demo/sample-document.js';
import { starterBrowserExtensions } from '../browser.js';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function fixture() {
  const comments = createCommentStore<string>();

  const editor = createEditor({
    schema: createSchema({
      extensions: [
        commentView(comments),
        searchView,
        ...starterBrowserExtensions({ imageDelay: 80, bodySize: 20 }),
      ],
    }),
    document: [
      ...createSampleDocument().slice(0, 4),
      ...Array.from({ length: 60 }, (_, index) => ({
        kind: 'paragraph' as const,
        id: 1000 + index,
        key: `filler-${index}`,
        text: `Distant paragraph ${index}`,
        marks: [],
        inline: [],
      })),
    ],
  });

  comments.put({
    id: 'discussion',
    messages: ['Comment'],
    range: editor.positions.range(editor.positions.at(2, 0, 1), editor.positions.at(2, 9, -1)),
  });
  const root = document.createElement('div');
  root.style.cssText = 'position:relative;width:500px;height:700px;';
  document.body.append(root);
  const diagnostics = createViewDiagnostics({ composition: 'eager', retention: 'all' });

  const opened: {
    kind: string;
    node: number;
    id: string;
    index: number;
    focus?: 'text' | 'panel';
  }[] = [];

  onMentionActivate(editor, ({ nodeId, id, index }) =>
    opened.push({ kind: 'mention', node: nodeId, id, index }),
  );
  onCommentActivate(editor, ({ nodeId, id, index, focus }) =>
    opened.push({ kind: 'comment', node: nodeId, id, index, focus }),
  );

  return {
    editor,
    root,
    diagnostics,
    opened,
    project: createDemoDocumentQuery(editor.schema),
    destroy() {
      editor.destroy();
      root.remove();
    },
  };
}

function button(root: HTMLElement, selector: string) {
  const value = root.querySelector<HTMLButtonElement>(selector);

  if (!value) throw new Error(`Missing button: ${selector}`);

  return value;
}

test('native block layer paints and positions comments and mentions, preserves label caches across culling, and owns cleanup', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const view = mountEditor(f.root, { editor: f.editor, diagnostics: f.diagnostics });
  await view.ready;
  const mention = button(f.root, '[data-mention]');
  const comment = button(f.root, '[data-decoration="2"]');
  mention.click();
  expect(f.opened.at(-1)).toMatchObject({ kind: 'mention', node: 1, id: 'maya' });
  comment.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(f.opened).toHaveLength(1);
  comment.click();
  expect(f.opened.at(-1)).toMatchObject({
    kind: 'comment',
    node: 2,
    id: 'discussion',
    focus: 'panel',
  });
  expect(comment.hasAttribute('data-editor-text-hit')).toBe(true);
  const placement = f.diagnostics.placements([1])[0];
  await nextFrame();
  const canvas = f.root.querySelector('canvas');
  const context = canvas?.getContext('2d');

  if (!canvas || !context) throw new Error('Missing canvas context');
  const canvasBounds = canvas.getBoundingClientRect();
  const mentionBounds = mention.getBoundingClientRect();
  expect(mentionBounds.left - canvasBounds.left).toBeCloseTo(28 + placement.boxes[0].x, 1);
  expect(mentionBounds.top - canvasBounds.top).toBeCloseTo(placement.y + placement.boxes[0].y, 1);
  expect([
    ...context.getImageData(
      Math.floor((parseFloat(comment.style.left) + 2) * devicePixelRatio),
      Math.floor((parseFloat(comment.style.top) + 2) * devicePixelRatio),
      1,
      1,
    ).data,
  ]).toEqual([246, 234, 180, 255]);
  const glyphs = f.diagnostics.read()?.stats.glyphCalls;
  expect(f.diagnostics.read()?.painterCount).toBe(3);
  f.editor.select(textSelection(1050, 0));
  expect(await view.reveal({ id: 1050, offset: 0 }, { align: 'start' })).toBe(true);
  expect(f.diagnostics.read()?.painterCount).toBe(0);
  expect(f.root.querySelector('[data-mention]')).toBeNull();
  f.editor.select(textSelection(1, 0));
  expect(await view.reveal({ id: 1, offset: 0 }, { align: 'start' })).toBe(true);
  expect(f.diagnostics.read()?.stats.glyphCalls).toBe(glyphs);
  expect(f.diagnostics.read()?.painterCount).toBe(3);
  f.editor.destroy();
  expect(view.isDestroyed).toBe(true);
  expect(f.diagnostics.read()).toBeNull();
  expect(f.root.children).toHaveLength(0);
  mention.click();
  expect(f.opened).toHaveLength(2);
});

test('native block layer edits table content, reports native focus and renders structural decorations', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const view = mountEditor(f.root, { editor: f.editor, diagnostics: f.diagnostics });
  await view.ready;
  const table = f.root.querySelector<HTMLElement>('[data-table]');

  if (!table) throw new Error('Missing table');
  table.focus();
  button(f.root, '[aria-label="Edit cell 1, 1"]').click();
  const input = f.root.querySelector('.table-block textarea');

  if (!(input instanceof HTMLTextAreaElement)) throw new Error('Missing table input');
  await expect.poll(() => document.activeElement).toBe(input);
  input.value = 'Native layer edit';
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Native layer edit' }));
  expect(f.root.querySelector('.table-block textarea')).toBe(input);
  expect(f.project(f.editor.state).tree.byId.get(20002)?.node).toMatchObject({
    text: 'Native layer edit',
  });
  view.scrollTo(view.blockBounds(1050)?.top ?? 0);
  await nextFrame();
  expect(f.root.querySelector('.table-block textarea')).toBe(input);
  expect(document.activeElement).toBe(input);
  f.editor.select(textSelection(1, 0));
  f.editor.commands.focus();
  f.editor.commands.toggleQuote();
  await view.reveal({ id: 1, offset: 0 });
  expect(f.root.querySelector('[data-quote]')).not.toBeNull();
  f.editor.commands.undo();
  await expect.poll(() => f.root.querySelector('[data-quote]')).toBeNull();
  f.editor.commands.undo();
  expect(f.project(f.editor.state).tree.byId.get(20002)?.node).toMatchObject({
    text: 'Keep the first release focused.',
  });
  f.editor.select(textSelection(1050, 0));
  await view.reveal({ id: 1050, offset: 0 }, { align: 'start' });
  expect(f.root.querySelector('[data-table]')).toBeNull();
  f.editor.select(textSelection(1, 0));
  await view.reveal({ id: 1, offset: 0 }, { align: 'start' });
  expect(f.root.querySelector('[data-table]')).not.toBeNull();
});

test('React strict remounts attach the native block layer without retaining painters or reviving a destroyed session', async ({
  onTestFinished,
}) => {
  const f = fixture();
  const root = createRoot(f.root);
  onTestFinished(() => {
    flushSync(() => root.unmount());
    f.destroy();
  });
  let mounted: MountedEditor | undefined;

  function render(key: string) {
    flushSync(() =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(EditorContent<(typeof f.editor.state.nodes)[number]>, {
            key,
            editor: f.editor,
            diagnostics: f.diagnostics,
            style: { width: 500, height: 700 },
            onReady: (view) => {
              mounted = view;
            },
          }),
        ),
      ),
    );
  }

  render('first');
  await expect.poll(() => mounted?.status).toBe('ready');
  expect(f.diagnostics.read()?.painterCount).toBe(3);
  expect(f.root.querySelectorAll('[data-mention]')).toHaveLength(1);
  const first = mounted;
  render('second');
  await expect.poll(() => mounted !== first && mounted?.status === 'ready').toBe(true);
  expect(first?.isDestroyed).toBe(true);
  expect(f.diagnostics.read()?.painterCount).toBe(3);
  expect(f.root.querySelectorAll('[data-mention]')).toHaveLength(1);
  f.editor.destroy();
  expect(f.diagnostics.read()).toBeNull();
  expect(f.root.querySelector('[data-mention]')).toBeNull();
  render('second');
  render('third');
  expect(f.diagnostics.read()).toBeNull();
  expect(f.root.querySelector('[data-mention]')).toBeNull();
});
