import { createEditor } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { textSelection } from '@gprose/state';
import { expect, test } from 'vitest';

import { createKeyboardShortcuts } from '../../../editor-browser';
import { createDocumentPresentation } from '../../../editor-canvas/presentation';
import { createSampleDocument, type TableNode } from '../../demo-model';
import { tableCells } from '../../table';
import { starterInput } from '../browser';
import { createStarterDocumentQuery } from '../browser-document';
import { starterExtensions } from '../index';
import { starterPresentation } from '../presentation';
import { createTableView, type TableFrame } from '../table-view';

function fixture(writable = true) {
  let editable = writable;

  const editor = createEditor({
    schema: createSchema({ extensions: [...starterExtensions, starterPresentation, starterInput] }),
    document: createSampleDocument().slice(0, 4),
    permissions: { access: () => (editable ? 'editable' : 'read-only') },
  });

  const shortcuts = createKeyboardShortcuts(editor);
  const project = createStarterDocumentQuery(editor.schema);
  const presentation = createDocumentPresentation(editor);
  const host = document.createElement('div');
  host.style.width = '400px';
  document.body.append(host);
  const view = createTableView(host, editor.schema);
  const reports: { id: number; width: number; height: number }[] = [];
  const clipboard: string[] = [];
  let overrides: Partial<TableFrame<TableNode>> = {};

  function frame() {
    const node = editor.state.nodes.find((value) => value.kind === 'table');

    if (!node) throw new Error('Missing fixture table');

    return {
      node,
      width: 400,
      textStyle(id) {
        const text = project(editor.state).tree.byId.get(id)?.node;

        if (!text) return null;
        const style = presentation.present(text);

        return style.kind === 'text'
          ? {
              ...style,
              cssFamily: 'sans-serif',
              color: '#252a23',
              baselineOffset: 0,
              font: { family: 'sans-serif', weight: style.font?.weight ?? 400, style: 'normal' },
            }
          : null;
      },
      onMeasure: (id, width, height) => reports.push({ id, width, height }),
      selection: editor.state.selection,
      context: project(editor.state).context,
      access: (id) => editor.getAccess(id),
      onSelect: (selection) => editor.select(selection),
      onText: (id, from, to, text, caret) => {
        return editor
          .chain({ history: { group: `typing:${id}` } })
          .replaceText({ id, from, to, text, caret })
          .run();
      },
      onComposition: () => editor.breakHistory(),
      onKeyDown: shortcuts,
      onReplace: (text) => {
        editor.commands.replaceSelection(text);
      },
      clipboard: {
        copy: () => clipboard.push('copy'),
        cut: () => clipboard.push('cut'),
        paste: () => clipboard.push('paste'),
      },
      ...overrides,
    } satisfies TableFrame<TableNode>;
  }

  const unsubscribe = editor.subscribe(() => view.update(frame()));
  view.update(frame());

  function button(label: string) {
    const target = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

    if (!target) throw new Error(`Missing button: ${label}`);

    return target;
  }

  function input() {
    const target = host.querySelector('textarea');

    if (!target) throw new Error('Missing native input');

    return target;
  }

  return {
    editor,
    host,
    view,
    reports,
    clipboard,
    button,
    input,
    frame,
    setWritable(value: boolean) {
      editable = value;
      editor.refreshPermissions();
    },
    update(next: Partial<TableFrame<TableNode>>) {
      overrides = next;
      view.update(frame());
    },
    destroy() {
      unsubscribe();
      view.destroy();
      editor.destroy();
      host.remove();
    },
  };
}

function type(input: HTMLTextAreaElement, value: string) {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
  );
}

function key(element: HTMLElement, name: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...options,
  });

  element.dispatchEvent(event);

  return event;
}

test('native table editing keeps input identity, focus, direction, formatting and undo without React', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.button('Edit cell 1, 1').click();
  const input = f.input();
  expect(document.activeElement).toBe(input);
  type(input, 'Edited native text');
  expect(f.frame().node.rows[0][0].paragraphs[0].text).toBe('Edited native text');
  expect(f.input()).toBe(input);
  expect(document.activeElement).toBe(input);
  input.setSelectionRange(0, 6, 'backward');
  input.dispatchEvent(new Event('select', { bubbles: true }));
  expect(f.editor.state.selection.eq(textSelection(20002, 6, 0))).toBe(true);
  key(input, 'b', { ctrlKey: true });
  expect(f.frame().node.rows[0][0].paragraphs[0].marks).toHaveLength(1);
  expect(f.input()).toBe(input);
  expect(input.selectionDirection).toBe('backward');
  key(input, 'z', { ctrlKey: true });
  expect(f.frame().node.rows[0][0].paragraphs[0].marks).toHaveLength(0);
  key(input, 'z', { ctrlKey: true });
  expect(input.value).toBe('Keep the first release focused.');
  key(input, 'z', { ctrlKey: true, shiftKey: true });
  expect(input.value).toBe('Edited native text');
  expect(f.reports.at(-1)?.height).toBeGreaterThan(0);
});

test('native table rows and cells reconcile around active input and route rectangular selection and clipboard', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.button('Edit cell 1, 1').click();
  const first = f.input();
  f.editor.commands.addTableRow();
  expect(f.host.querySelectorAll('tr')).toHaveLength(2);
  expect(f.input()).toBe(first);
  key(first, 'Tab');
  expect(f.input().getAttribute('aria-label')).toBe('Cell 2, 1 text');
  key(f.input(), 'Tab', { shiftKey: true });
  expect(f.input().getAttribute('aria-label')).toBe('Cell 1, 1 text');
  f.input().dispatchEvent(new ClipboardEvent('copy', { bubbles: true }));
  expect(f.clipboard).toEqual([]);
  f.button('Select cell 1, 1').click();
  f.button('Select cell 2, 1').dispatchEvent(
    new MouseEvent('click', { bubbles: true, shiftKey: true }),
  );
  expect(f.editor.state.selection).toBeInstanceOf(tableCells.CellSelection);
  expect(f.host.querySelectorAll('[data-cell][data-selected="true"]')).toHaveLength(2);
  expect(document.activeElement).toBe(f.host);

  for (const name of ['copy', 'cut', 'paste'])
    f.host.dispatchEvent(new ClipboardEvent(name, { bubbles: true }));
  expect(f.clipboard).toEqual(['copy', 'cut', 'paste']);
  key(f.host, 'Delete');
  expect(
    f
      .frame()
      .node.rows.flat()
      .every((cell) => cell.paragraphs[0].text === ''),
  ).toBe(true);
  key(f.host, 'z', { ctrlKey: true });
  expect(f.frame().node.rows[0][0].paragraphs[0].text).toBe('Keep the first release focused.');
  f.editor.commands.undo();
  expect(f.host.querySelectorAll('tr')).toHaveLength(1);
  expect(f.host.querySelectorAll('[data-cell]')).toHaveLength(1);
});

test('native table lifecycle isolates overlapping IDs, preserves composition, and cancels measurements on destroy', async ({
  onTestFinished,
}) => {
  const first = fixture();
  const second = fixture();
  onTestFinished(() => {
    first.destroy();
    second.destroy();
  });
  first.button('Edit cell 1, 1').click();
  const input = first.input();
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  input.value = 'Composing';
  first.update({ width: 360 });
  expect(input.value).toBe('Composing');
  expect(key(input, 'Tab', { isComposing: true }).defaultPrevented).toBe(false);
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  type(input, 'Composed');
  expect(first.frame().node.rows[0][0].paragraphs[0].text).toBe('Composed');
  expect(second.frame().node.rows[0][0].paragraphs[0].text).toBe('Keep the first release focused.');
  const reports = first.reports.length;
  first.view.destroy();
  first.view.destroy();
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(first.reports).toHaveLength(reports);
  expect(first.host.textContent).toBe('');
  expect(first.host.hasAttribute('data-table')).toBe(false);
  expect(() => first.view.update(first.frame())).toThrow(/destroyed/);
  second.button('Edit cell 1, 1').click();
  type(second.input(), 'Still alive');
  expect(second.frame().node.rows[0][0].paragraphs[0].text).toBe('Still alive');
});

test('native table input restores canonical text when permissions reject an edit', ({
  onTestFinished,
}) => {
  const f = fixture(false);
  onTestFinished(() => f.destroy());
  f.button('Edit cell 1, 1').click();
  const input = f.input();
  type(input, 'Must not persist');
  expect(input.readOnly).toBe(true);
  expect(input.value).toBe('Keep the first release focused.');
  expect(f.frame().node.rows[0][0].paragraphs[0].text).toBe(input.value);
  expect(document.activeElement).toBe(input);
  f.setWritable(true);
  expect(f.input()).toBe(input);
  expect(input.readOnly).toBe(false);
  type(input, 'Permitted');
  expect(f.frame().node.rows[0][0].paragraphs[0].text).toBe('Permitted');
  f.setWritable(false);
  expect(input.readOnly).toBe(true);
  expect(document.activeElement).toBe(input);
});

test('highlight-only frames update displayed ranges without replacing the active native input', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());

  const highlights = new Map([
    [
      20002,
      [
        {
          kind: 'text' as const,
          key: 'match',
          from: 0,
          to: 4,
          background: '#ffec97',
          attributes: { 'data-find-match': 'true', 'data-find-active': 'false' },
        },
      ],
    ],
  ]);

  f.update({ textDecorations: (id) => highlights.get(id) ?? [] });
  expect(f.host.querySelector('[data-find-match]')?.textContent).toBe('Keep');
  f.button('Edit cell 1, 1').click();
  const input = f.input();
  input.setSelectionRange(1, 4, 'backward');
  input.dispatchEvent(new Event('select', { bubbles: true }));
  const selection = f.editor.state.selection;
  f.update({
    textDecorations: (id) =>
      new Map([
        [
          20002,
          [
            {
              kind: 'text' as const,
              key: 'match',
              from: 0,
              to: 4,
              background: '#f5b941',
              attributes: { 'data-find-match': 'true', 'data-find-active': 'true' },
            },
          ],
        ],
      ]).get(id) ?? [],
  });
  expect(f.input()).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.selectionDirection).toBe('backward');
  expect(f.editor.state.selection.eq(selection)).toBe(true);
});
