import { createEditor, defineExtension, inputRules, type ContributionContext } from '@kerned/core';
import { editingCommands } from '@kerned/extension-editing';
import { createSchema } from '@kerned/model';
import { starterBrowserExtensions } from '@kerned/starter-kit/browser';
import { textSelection } from '@kerned/state';
import { pasteRules } from '@kerned/view';
import { defaultFonts, type FontConfiguration } from '@kerned/view';
import { mountEditor } from '@kerned/view';
import { expect, test, onTestFinished as registerCleanup } from 'vitest';

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function fixture(
  cleanup: (callback: () => void) => void,
  id: number,
  fonts?: FontConfiguration,
) {
  const calls: string[] = [];

  const rules = defineExtension({
    name: 'customRules',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(inputRules, {
        find: /--/,
        run({ transaction, range }) {
          calls.push('input');

          return transaction.command(editingCommands.insertText, '—', range);
        },
      });
      context.provide(pasteRules, {
        priority: 10,
        run({ transaction }) {
          calls.push('decline');
          transaction.command(editingCommands.insertText, 'DISCARDED');
          transaction.effect(() => calls.push('discarded effect'));

          return false;
        },
      });
      context.provide(pasteRules, {
        run({ transaction, clipboard }) {
          calls.push('paste');

          if (clipboard.getData('text/plain') !== ':dash:') return false;

          return transaction.command(editingCommands.insertText, 'CUSTOM');
        },
      });

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [...starterBrowserExtensions(), rules] }),
    content: [
      { kind: 'paragraph', id: 1, text: '' },
      {
        kind: 'table',
        id: 2,
        caption: '',
        rows: [
          [
            {
              kind: 'tableCell',
              id: 3,
              row: 0,
              header: false,
              colspan: 1,
              rowspan: 1,
              paragraphs: [{ kind: 'paragraph', id: 4, text: '' }],
            },
          ],
        ],
      },
    ],
    selection: textSelection(id, 0),
  });

  const host = document.createElement('div');
  host.style.cssText = 'width:600px;height:400px';
  document.body.append(host);
  const notices: string[] = [];
  const view = mountEditor(host, { editor, fonts, onNotice: (value) => notices.push(value) });
  cleanup(() => {
    view.destroy();
    editor.destroy();
    host.remove();
  });
  await view.ready;
  editor.commands.focus();
  await frame();

  const input = host.querySelector<HTMLTextAreaElement>(
    id === 1 ? '[data-editor-input]' : '.table-block textarea',
  );

  if (!input) throw new Error('Missing input');

  const text = () => {
    const node = editor.getNode(id);

    return node ? editor.schema.text(node) : null;
  };

  const type = async (value: string, options: InputEventInit = {}) => {
    input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText', ...options }),
    );
    await frame();
  };

  return { editor, input, calls, notices, text, type, view };
}

for (const id of [1, 4]) {
  const surface = id === 1 ? 'canvas' : 'table cell';
  test(`${surface} input transformations synchronize capture and undo to literal text`, async ({
    onTestFinished,
  }) => {
    const f = await fixture(onTestFinished, id);
    await f.type('-');
    await f.type('-');
    expect(f.text()).toBe('—');
    expect(f.input.value).toBe('—');
    expect(f.calls).toEqual(['input']);
    await f.type('!');
    expect(f.text()).toBe('—!');
    f.editor.commands.undo();
    expect(f.text()).toBe('—');
    f.editor.commands.undo();
    expect(f.text()).toBe('--');
    f.editor.commands.undo();
    expect(f.text()).toBe('');
    expect(f.notices.filter(Boolean)).toEqual([]);
  });

  test(`${surface} IME waits for composition end and ignores the trailing unchanged input event`, async ({
    onTestFinished,
  }) => {
    const f = await fixture(onTestFinished, id);
    f.input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    await f.type('--', { isComposing: true, inputType: 'insertCompositionText' });
    expect(f.text()).toBe('--');
    expect(f.calls).toEqual([]);
    f.input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '--' }));
    f.input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }),
    );
    await expect.poll(f.text).toBe('—');
    expect(f.calls).toEqual(['input']);
    f.editor.commands.undo();
    expect(f.text()).toBe('--');
    expect(f.notices.filter(Boolean)).toEqual([]);
  });

  test(`${surface} Chinese composition replaces candidates once and forms a single undo group`, async ({
    onTestFinished,
  }) => {
    const f = await fixture(onTestFinished, id, {
      ...defaultFonts,
      fallbackFamilies: [...(defaultFonts.fallbackFamilies ?? []), 'Chinese'],
      faces: [
        ...defaultFonts.faces,
        {
          family: 'Chinese',
          weight: 400,
          style: 'normal',
          asset: 'fonts/NotoSansCJKtc-Regular.otf',
        },
      ],
    });

    f.input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    const candidate = async (value: string) => {
      f.input.value = value;
      f.input.setSelectionRange(value.length, value.length);
      f.input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertCompositionText',
          data: value,
          isComposing: true,
        }),
      );
      await frame();
      expect(f.text()).toBe(value);
    };

    await candidate('ni');
    await candidate('你');
    await candidate('你好');
    f.input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }));
    f.input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '你好' }),
    );
    await frame();
    expect(f.text()).toBe('你好');
    expect(f.input.value).toBe('你好');
    expect(f.view.status).toBe('ready');
    f.editor.commands.undo();
    expect(f.text()).toBe('');
    f.editor.commands.redo();
    expect(f.text()).toBe('你好');
    expect(f.notices.filter(Boolean)).toEqual([]);
  });

  test(`${surface} paste rules discard declined edits and own a handled event once`, async ({
    onTestFinished,
  }) => {
    const f = await fixture(onTestFinished, id);
    const data = new DataTransfer();

    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });

    event.clipboardData?.setData('text/plain', ':dash:');
    f.input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(f.calls).toEqual(['decline', 'paste']);
    expect(f.text()).toBe('CUSTOM');
    expect(f.editor.history.undo).toBe(1);
    f.editor.commands.undo();
    expect(f.text()).toBe('');
    expect(f.notices.filter(Boolean)).toEqual([]);
  });

  test(`${surface} native paste input never triggers typing rules`, async ({ onTestFinished }) => {
    const f = await fixture(onTestFinished, id);
    await f.type('--', { inputType: 'insertFromPaste' });
    expect(f.text()).toBe('--');
    expect(f.calls).toEqual([]);
  });

  test.each(['insertFromPaste', 'insertFromDrop'])(
    `${surface} %s has separate undo from surrounding typing`,
    async (inputType) => {
      const f = await fixture(registerCleanup, id);
      await f.type('Before');
      await f.type(' pasted', { inputType });
      await f.type(' after');
      expect(f.text()).toBe('Before pasted after');
      f.editor.commands.undo();
      expect(f.text()).toBe('Before pasted');
      f.editor.commands.undo();
      expect(f.text()).toBe('Before');
      f.editor.commands.undo();
      expect(f.text()).toBe('');
      f.editor.commands.redo();
      expect(f.text()).toBe('Before');
      f.editor.commands.redo();
      expect(f.text()).toBe('Before pasted');
      f.editor.commands.redo();
      expect(f.text()).toBe('Before pasted after');
      expect(f.notices.filter(Boolean)).toEqual([]);
    },
  );
}

test('declining paste rules preserve rich rectangular paste in native cells', async ({
  onTestFinished,
}) => {
  const f = await fixture(onTestFinished, 4);

  const event = new ClipboardEvent('paste', {
    clipboardData: new DataTransfer(),
    bubbles: true,
    cancelable: true,
  });

  event.clipboardData?.setData(
    'text/html',
    '<table><tr><td><p><strong>Rich</strong></p></td></tr></table>',
  );
  event.clipboardData?.setData('text/plain', 'Rich');
  f.input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(f.calls).toEqual(['decline', 'paste']);
  const table = f.editor.getNode(2);
  expect(table).toMatchObject({
    kind: 'table',
    rows: [[{ paragraphs: [{ text: 'Rich', marks: [{ mark: { type: 'bold' } }] }] }]],
  });
  expect(f.editor.history.undo).toBe(1);
  f.editor.commands.undo();
  expect(f.text()).toBe('');
  expect(f.notices.filter(Boolean)).toEqual([]);
});
