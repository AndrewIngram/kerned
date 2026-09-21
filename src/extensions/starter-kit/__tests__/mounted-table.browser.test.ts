import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../../core';
import {
  mountEditor,
  defineNodePresentation,
  presentations,
  defineStyleRule,
} from '../../../editor-canvas';
import { createSchema, defineNode } from '../../../model';
import { textSelection } from '../../../state';
import { formattingSpans } from '../../formatting';
import { paragraph } from '../../starter-definitions';
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

const notePresentation = defineExtension({
  name: 'notePresentation',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(note, () => (attrs, node) => ({
        kind: 'text',
        text: attrs.body,
        size: 18,
        lineHeight: 28,
        before: 0,
        after: 16,
        baselineGrid: 4,
        spans: formattingSpans(node.marks),
        atoms: [],
      })),
    );

    return {};
  },
});

async function fixture(cleanup: (fn: () => void) => void) {
  let writable = true;

  const editor = createEditor({
    schema: createSchema({ extensions: [...starterBrowserExtensions(), note, notePresentation] }),
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

test('public geometry and reveal locate native cell text without changing selection or focus', async ({
  onTestFinished,
}) => {
  const f = await fixture(onTestFinished);
  const input = await f.focus();
  const start = f.view.coordsAt({ id: 3, offset: 0 });
  const end = f.view.coordsAt({ id: 3, offset: 6 });
  expect(start?.height).toBeGreaterThan(0);
  expect(end?.left).toBeGreaterThan(start?.left ?? 0);
  expect(f.view.coordsAt({ id: 3, offset: 100 })).toBeNull();
  // Native descendants share their rendered owner's document bounds, while
  // coordsAt resolves the individual cell's text geometry.
  expect(f.view.blockBounds(3)).toEqual(f.view.blockBounds(1));
  expect(f.view.blockBounds(3)?.id).toBe(1);
  f.view.update({ zoom: 1.25, paddingTop: 24 });
  expect(f.view.getSnapshot()?.zoom).toBe(1.25);
  expect(f.cellInput()).toBe(input);
  expect(document.activeElement).toBe(input);
  const original = f.editor.state.selection;
  f.editor.transact((draft) => {
    draft.step({
      kind: 'replaceChildren',
      parent: null,
      index: 0,
      count: 0,
      nodes: Array.from({ length: 60 }, (_, index) =>
        f.editor.schema
          .node(paragraph)
          .create(
            { id: index + 10, key: `before-table-${index}` },
            { text: `Preceding paragraph ${index}` },
          ),
      ),
    });

    return true;
  });
  expect(await f.view.reveal({ id: 5, offset: 4 })).toBe(true);
  const point = f.view.coordsAt({ id: 5, offset: 4 });
  const bounds = f.host.getBoundingClientRect();
  expect(point?.top).toBeGreaterThanOrEqual(bounds.top - 1);
  expect(point?.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(6);
  expect(f.editor.state.selection.eq(original)).toBe(true);
  f.editor.select(textSelection(5, 4));
  f.editor.commands.scrollIntoView();
  await expect
    .poll(() => f.view.coordsAt({ id: 5, offset: 4 })?.top)
    .toBeGreaterThanOrEqual(bounds.top - 1);
});

test('revealing native text scrolls a narrow table locally', async ({ onTestFinished }) => {
  const f = await fixture(onTestFinished);
  f.host.style.width = '180px';
  const table = f.host.querySelector<HTMLElement>('.table-block');

  if (!table) throw new Error('Missing table');
  await expect.poll(() => table.clientWidth).toBe(150);
  const focus = document.activeElement;
  const selection = f.editor.state.selection;
  expect(f.view.coordsAt({ id: 5, offset: 6 })?.right).toBeGreaterThan(
    table.getBoundingClientRect().right,
  );
  expect(await f.view.reveal({ id: 5, offset: 6 })).toBe(true);
  expect(table.scrollLeft).toBeGreaterThan(0);
  const caret = f.view.coordsAt({ id: 5, offset: 6 });
  const bounds = table.getBoundingClientRect();
  expect(caret?.left).toBeGreaterThanOrEqual(bounds.left - 1);
  expect(caret?.right).toBeLessThanOrEqual(bounds.right + 1);
  expect(document.activeElement).toBe(focus);
  expect(f.editor.state.selection.eq(selection)).toBe(true);
});

test('custom cell text and its native input share live resolved styles without losing selection or focus', async ({
  onTestFinished,
}) => {
  const f = await fixture(onTestFinished);
  const preview = f.button('Edit cell 1, 1');
  expect(getComputedStyle(preview).fontSize).toBe('18px');
  const original = f.editor.state;
  f.view.update({
    theme: {
      baselineGrid: 0,
      rules: [
        defineStyleRule(note, { size: 26, lineHeight: 42, font: { weight: 700, style: 'italic' } }),
      ],
    },
  });
  const style = getComputedStyle(preview);
  expect(style.fontSize).toBe('26px');
  expect(style.lineHeight).toBe('42px');
  expect(style.fontWeight).toBe('700');
  expect(style.fontStyle).toBe('italic');
  const family = style.fontFamily;
  const input = await f.focus();
  expect(getComputedStyle(input).fontFamily).toBe(family);
  expect(getComputedStyle(input).lineHeight).toBe('42px');
  const height = input.getBoundingClientRect().height;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  f.view.update({ theme: { rules: [defineStyleRule(note, { size: 30, lineHeight: 60 })] } });
  expect(f.cellInput()).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(start);
  expect(input.selectionEnd).toBe(end);
  expect(getComputedStyle(input).lineHeight).toBe('60px');
  expect(input.getBoundingClientRect().height).toBeGreaterThan(height);
  expect(f.editor.state).toBe(original);
  f.view.update({ theme: {} });
  expect(getComputedStyle(input).fontSize).toBe('18px');
  expect(getComputedStyle(input).lineHeight).toBe('28px');
  expect(document.activeElement).toBe(input);
});
