import { createEditor } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { mountEditor } from '@gprose/view';
import { expect, test } from 'vitest';

import { createCommentStore } from '../comment';
import { commentView } from '../comment-view';
import { searchView } from '../search-view';
import { starterBrowserExtensions } from '../starter-kit/browser';

function pixels(host: HTMLElement) {
  const canvas = host.querySelector('canvas');
  const context = canvas?.getContext('2d');

  if (!canvas || !context) throw new Error('Missing software canvas');
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;

  let active = 0,
    ordinary = 0,
    activeX = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 153 && data[i + 1] === 51 && data[i + 2] === 102) {
      active++;
      activeX += (i / 4) % canvas.width;
    }

    if (data[i] === 51 && data[i + 1] === 170 && data[i + 2] === 119) ordinary++;
  }

  return { active, ordinary, activeX: active ? activeX / active : 0 };
}

test('public mount paints configured search results and follows navigation, clear and remount', async ({
  onTestFinished,
}) => {
  const comments = createCommentStore<string>();

  const editor = createEditor({
    schema: createSchema({
      extensions: [
        commentView(comments),
        searchView.configure({ color: '#33aa77', activeColor: '#993366' }),
        ...starterBrowserExtensions(),
      ],
    }),
    content: [
      { kind: 'paragraph', id: 1, text: 'idea another idea. '.repeat(12) },
      {
        kind: 'table',
        id: 2,
        caption: 'Searchable table',
        rows: [
          [
            {
              kind: 'tableCell',
              id: 3,
              row: 0,
              header: false,
              colspan: 1,
              rowspan: 1,
              paragraphs: [{ kind: 'paragraph', id: 4, text: 'Native idea' }],
            },
          ],
        ],
      },
    ],
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
  await view.ready;
  const before = editor.state;
  comments.put({
    id: 'native-thread',
    messages: ['Discussion'],
    range: editor.positions.range(editor.positions.at(4, 7, 1), editor.positions.at(4, 11, -1)),
  });
  await expect
    .poll(() => host.querySelector('[data-comment-range="native-thread"]')?.textContent)
    .toBe('idea');
  await editor.find.setQueryAsync('idea');
  await expect.poll(() => pixels(host).active).toBeGreaterThan(20);
  expect(pixels(host).ordinary).toBeGreaterThan(pixels(host).active);
  const firstX = pixels(host).activeX;
  editor.find.next();
  await expect.poll(() => pixels(host).activeX).toBeGreaterThan(firstX + 10);
  expect(editor.state).toBe(before);
  await expect.poll(() => host.querySelector('[data-find-match]')?.textContent).toBe('idea');
  const native = host.querySelector<HTMLElement>('[data-find-match]');
  expect(native?.style.backgroundColor).toBe('rgb(51, 170, 119)');
  editor.find.previous();
  editor.find.previous();
  await expect
    .poll(() => host.querySelector('[data-find-active="true"]')?.textContent)
    .toBe('idea');
  editor.find.clear();
  await expect.poll(() => pixels(host).active + pixels(host).ordinary).toBe(0);
  await expect.poll(() => host.querySelector('[data-find-match]')).toBeNull();
  expect(host.querySelector('[data-comment-range="native-thread"]')?.textContent).toBe('idea');
  comments.remove('native-thread');
  await expect.poll(() => host.querySelector('[data-comment-range]')).toBeNull();
  view.destroy();
  await editor.find.setQueryAsync('idea');
  expect(host.children).toHaveLength(0);
  view = mountEditor(host, { editor });
  await view.ready;
  await expect.poll(() => pixels(host).active).toBeGreaterThan(20);
  expect(editor.state).toBe(before);
});
