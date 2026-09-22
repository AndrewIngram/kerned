import { createEditor } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { starterBrowserExtensions } from '@gprose/starter-kit/browser';
import { textSelection } from '@gprose/state';
import { mountEditor } from '@gprose/view';
import { expect, test, onTestFinished } from 'vitest';
import { userEvent } from 'vitest/browser';

import { chineseFonts } from '../sample-fonts.js';

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

test.each([280, 700])('Chinese composition, selection and undo work at %ipx', async (width) => {
  const editor = createEditor({
    schema: createSchema({ extensions: starterBrowserExtensions() }),
    content: [{ kind: 'paragraph', id: 1, text: '天地玄黃，宇宙洪荒。' }],
    selection: textSelection(1, 0),
  });

  const host = document.createElement('div');
  host.style.cssText = `width:${width}px;height:300px;`;
  document.body.append(host);
  const notices: string[] = [];

  const view = mountEditor(host, {
    editor,
    fonts: chineseFonts,
    onNotice: (message) => notices.push(message),
  });

  onTestFinished(() => {
    view.destroy();
    editor.destroy();
    host.remove();
  });
  await view.ready;
  editor.commands.focus();
  const input = host.querySelector('textarea');

  if (!input) throw new Error('Missing input');
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  input.setRangeText('zhong', input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      data: 'zhong',
      isComposing: true,
    }),
  );
  // The IME replaces its provisional Latin spelling with the chosen Han character.
  input.setRangeText('中', 0, 5, 'end');
  input.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      data: '中',
      isComposing: true,
    }),
  );
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }),
  );
  await frame();
  expect(editor.state.nodes[0]).toMatchObject({ text: '中天地玄黃，宇宙洪荒。' });
  editor.commands.undo();
  await frame();
  expect(editor.state.nodes[0]).toMatchObject({ text: '天地玄黃，宇宙洪荒。' });
  editor.select(textSelection(1, 0));
  editor.commands.focus();
  await userEvent.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}');
  expect(editor.state.selection).toMatchObject({
    anchor: { id: 1, offset: 0 },
    head: { id: 1, offset: 2 },
  });
  editor.commands.toggleFormat('bold');
  await frame();
  expect(editor.state.nodes[0]).toMatchObject({
    marks: [{ from: 0, to: 2, mark: { type: 'bold' } }],
  });
  await userEvent.keyboard('{Backspace}');
  expect(editor.state.nodes[0]).toMatchObject({ text: '玄黃，宇宙洪荒。' });
  editor.commands.undo();
  await frame();
  expect(editor.state.nodes[0]).toMatchObject({ text: '天地玄黃，宇宙洪荒。' });
  expect(notices.filter(Boolean)).toEqual([]);
  expect(view.status).toBe('ready');
});
