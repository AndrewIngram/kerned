import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor } from '../../../core';
import { mountEditor } from '../../../editor-canvas';
import { createSchema, defineNode } from '../../../model';
import { textSelection } from '../../../state';
import { tableCells } from '../../table';
import { starterBrowserExtensions } from '../browser';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({ body: z.string(), category: z.string() }),
    content: { kind: 'text', field: 'body', marks: 'styles' },
  }),
});

async function fixture(cleanup: (fn: () => void) => void) {
  let writable = true;

  const editor = createEditor({
    schema: createSchema({ extensions: [...starterBrowserExtensions(), note] }),
    content: [
      {
        kind: 'table',
        id: 1,
        caption: 'Custom cells',
        rows: [
          [
            {
              kind: 'tableCell',
              id: 2,
              row: 0,
              header: false,
              colspan: 1,
              rowspan: 1,
              paragraphs: [{ kind: 'note', id: 3, body: 'Custom text', category: 'review' }],
            },
            {
              kind: 'tableCell',
              id: 4,
              row: 0,
              header: false,
              colspan: 1,
              rowspan: 1,
              paragraphs: [{ kind: 'paragraph', id: 5, text: 'Second cell' }],
            },
          ],
        ],
      },
    ],
    permissions: { access: () => (writable ? 'editable' : 'read-only') },
    selection: textSelection(3, 6),
  });

  const host = document.createElement('div');
  host.style.cssText = 'width:600px;height:350px;';
  document.body.append(host);
  const notices: string[] = [];
  const view = mountEditor(host, { editor, onNotice: (message) => notices.push(message) });
  cleanup(() => {
    view.destroy();
    editor.destroy();
    host.remove();
  });
  await view.ready;

  function table() {
    const node = editor.state.nodes[0];

    if (node.kind !== 'table') throw new Error('Expected table');

    return node;
  }

  function cellInput() {
    const input = host.querySelector<HTMLTextAreaElement>('.table-block textarea');

    if (!input) throw new Error('Missing cell input');

    return input;
  }

  function button(label: string) {
    const target = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

    if (!target) throw new Error(`Missing ${label}`);

    return target;
  }

  async function focus() {
    editor.commands.focus();
    await expect
      .poll(() => document.activeElement === host.querySelector('.table-block textarea'))
      .toBe(true);

    return cellInput();
  }

  async function type(value: string) {
    const input = cellInput();
    input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  function key(value: string, shiftKey = false) {
    cellInput().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        ctrlKey: true,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  return {
    editor,
    host,
    view,
    notices,
    table,
    cellInput,
    button,
    focus,
    type,
    key,
    setWritable(value: boolean) {
      writable = value;
    },
  };
}

test('the public mount edits custom cell text, retains focus and formatting, and enforces permissions through history', async ({
  onTestFinished,
}) => {
  const f = await fixture(onTestFinished);
  const input = await f.focus();
  expect(input.selectionStart).toBe(6);
  await f.type('A');
  await f.type('B');
  expect(f.table().rows[0][0].paragraphs[0]).toMatchObject({
    kind: 'note',
    body: 'CustomAB text',
    category: 'review',
  });
  expect(f.editor.history.undo).toBe(1);
  expect(f.cellInput()).toBe(input);
  f.setWritable(false);
  const before = f.editor.state;
  await f.type('Denied');
  f.key('z');
  expect(f.editor.state).toBe(before);
  expect(input.value).toBe('CustomAB text');
  f.setWritable(true);
  f.key('z');
  await expect.poll(() => input.value).toBe('Custom text');
  expect(f.editor.history.undo).toBe(0);
  f.key('z', true);
  await expect.poll(() => input.value).toBe('CustomAB text');
  expect(f.editor.state.nodes).toEqual(before.nodes);
  f.editor.select(textSelection(3, 8, 6));
  await f.focus();
  f.key('b');
  await expect
    .poll(() => f.table().rows[0][0].paragraphs[0])
    .toMatchObject({
      styles: [{ from: 6, to: 8, mark: { type: 'bold' } }],
    });
  expect(f.cellInput()).toBe(input);
  expect(input.selectionDirection).toBe('backward');
  expect(document.activeElement).toBe(input);
});

test('mounted tables share rich rectangular clipboard policy and focus the pasted cell for continued typing', async ({
  onTestFinished,
}) => {
  const f = await fixture(onTestFinished);
  f.button('Select cell 1, 1').click();
  f.button('Select cell 1, 2').dispatchEvent(
    new MouseEvent('click', { bubbles: true, shiftKey: true }),
  );
  await expect
    .poll(() => f.host.querySelectorAll('[data-cell][data-selected="true"]').length)
    .toBe(2);
  expect(f.editor.state.selection).toBeInstanceOf(tableCells.CellSelection);
  const data = new DataTransfer();
  const table = f.host.querySelector('.table-block');

  if (!table) throw new Error('Missing table element');
  const copy = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
  table.dispatchEvent(copy);
  expect(copy.defaultPrevented).toBe(true);
  expect(f.notices.filter(Boolean)).toEqual([]);
  const copied = copy.clipboardData;

  if (!copied) throw new Error('Missing copied data');
  expect(copied.getData('text/plain')).toBe('Custom text\tSecond cell');
  expect(copied.getData('text/html')).toContain('<table>');
  const formats = [...copied.types].map((type) => [type, copied.getData(type)] as const);
  f.editor.select(textSelection(3, 2));
  const originalInput = await f.focus();

  const paste = new ClipboardEvent('paste', {
    clipboardData: new DataTransfer(),
    bubbles: true,
    cancelable: true,
  });

  for (const [type, value] of formats) paste.clipboardData?.setData(type, value);

  originalInput.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(true);
  await expect
    .poll(() => f.host.querySelectorAll('[data-cell][data-selected="true"]').length)
    .toBe(2);
  const pasted = f.table().rows[0][0].paragraphs[0];
  expect(pasted).toMatchObject({ kind: 'note', body: 'Custom text', category: 'review' });
  expect(pasted.id).not.toBe(3);
  f.editor.select(textSelection(pasted.id, 6));
  await f.focus();
  await f.type('!');
  expect(f.table().rows[0][0].paragraphs[0]).toMatchObject({ body: 'Custom! text' });
  expect(document.activeElement).toBe(f.cellInput());
  expect(f.notices.filter(Boolean)).toEqual([]);
  expect(f.view.status).toBe('ready');
});
