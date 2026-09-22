import { createEditor } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { starterBrowserExtensions } from '@gprose/starter-kit/browser';
import { textSelection } from '@gprose/state';
import { mountEditor } from '@gprose/view';
import { expect, test, onTestFinished } from 'vitest';
import { userEvent } from 'vitest/browser';

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

test.each([280, 700])(
  'mounted RTL text edits, selects, formats and undoes at %ipx',
  async (width) => {
    const editor = createEditor({
      schema: createSchema({ extensions: starterBrowserExtensions() }),
      content: [
        { kind: 'paragraph', id: 1, text: 'שלום עולם' },
        { kind: 'paragraph', id: 2, text: 'مرحبا بالعالم English 123' },
      ],
      selection: textSelection(1, 0),
    });

    const host = document.createElement('div');
    host.style.cssText = `width:${width}px;height:300px;`;
    document.body.append(host);
    const view = mountEditor(host, { editor });
    onTestFinished(() => {
      view.destroy();
      editor.destroy();
      host.remove();
    });
    await view.ready;
    editor.commands.focus();
    const input = host.querySelector('textarea');

    if (!input) throw new Error('Missing editor input');
    expect(input.dir).toBe('rtl');
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(editor.state.selection).toMatchObject({
      anchor: { id: 1, offset: 0 },
      head: { id: 1, offset: 1 },
    });
    input.setRangeText('שָׁ', input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'שָׁ' }),
    );
    await frame();
    expect(editor.state.nodes[0]).toMatchObject({ text: 'שָׁלום עולם' });
    await userEvent.keyboard('{Backspace}');
    expect(editor.state.nodes[0]).toMatchObject({ text: 'לום עולם' });
    editor.commands.undo();
    await frame();
    expect(editor.state.nodes[0]).toMatchObject({ text: 'שָׁלום עולם' });
    editor.select(textSelection(2, 0, 5));
    await frame();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await frame();
    expect(editor.state.nodes[1]).toMatchObject({
      marks: [{ from: 0, to: 5, mark: { type: 'bold' } }],
    });
    expect(input.dir).toBe('rtl');
    expect(view.status).toBe('ready');
  },
);
