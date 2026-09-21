import { expect, test } from 'vitest';

import { createEditor } from '../src/core';
import { createEditorControls } from '../src/demo/app/editor-controls';
import { createTextInput } from '../src/editor-browser';
import { starterExtensions } from '../src/extensions/starter-kit';
import { createStarterKitInput } from '../src/extensions/starter-kit/input';
import { createSchema } from '../src/model';
import { TextSelection, textSelection } from '../src/state';

function inputSession() {
  const schema = createSchema({ extensions: starterExtensions });

  const editor = createEditor({
    schema,
    content: [
      { kind: 'paragraph', id: 1, text: 'First' },
      { kind: 'paragraph', id: 2, text: 'Second' },
    ],
  });

  const input = document.createElement('textarea');
  const textInput = createTextInput(schema, editor);
  const notices: string[] = [];
  const notice = (message: string) => notices.push(message);

  const actions = createEditorControls({
    editor,
    notice,
    onEdit() {},
    closePanel() {},
    syncInput: () => textInput.sync(input),
  });

  const handlers = createStarterKitInput({
    editor,
    actions,
    textInput,
    input: () => input,
    notice,
    closePanel() {},
    escape() {},
    selectAll: () => editor.commands.selectAll(),
    navigate: () => false,
  });

  return { editor, input, textInput, notices, handlers };
}

test('retained clipboard handlers read the current selection and share the session paste command', () => {
  const { editor, notices, handlers } = inputSession();
  editor.select(new TextSelection({ id: 2, offset: 0 }, { id: 2, offset: 6 }));
  const copy = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), cancelable: true });
  handlers.copy?.(copy);
  expect(copy.clipboardData?.getData('text/plain')).toBe('Second');

  const paste = new ClipboardEvent('paste', {
    clipboardData: new DataTransfer(),
    cancelable: true,
  });

  if (!paste.clipboardData) throw new Error('Missing synthetic clipboard');
  paste.clipboardData.setData('text/html', '<p><strong>Replacement</strong></p>');
  paste.clipboardData.setData('text/plain', 'Replacement');
  const original = editor.state;
  handlers.paste?.(paste);
  expect(paste.defaultPrevented).toBe(true);
  expect(editor.state.nodes[0]).toMatchObject({ id: 1, text: 'First' });
  expect(editor.state.nodes[1]).toMatchObject({
    text: 'Replacement',
    marks: [{ mark: { type: 'bold' } }],
  });
  expect(editor.history.undo).toBe(1);
  expect(notices.filter(Boolean)).toEqual([]);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(original.nodes);

  // The same callback sees a subsequent selection without a React render or rebinding.
  editor.select(new TextSelection({ id: 1, offset: 0 }, { id: 1, offset: 5 }));

  const copyAgain = new ClipboardEvent('copy', {
    clipboardData: new DataTransfer(),
    cancelable: true,
  });

  handlers.copy?.(copyAgain);
  expect(copyAgain.clipboardData?.getData('text/plain')).toBe('First');
});

test('retained keyboard and text callbacks invoke current session commands', () => {
  const { editor, input, textInput, notices, handlers } = inputSession();
  editor.select(textSelection(2, 3));
  const before = editor.state;
  const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
  handlers.keydown?.(enter);
  expect(enter.defaultPrevented).toBe(true);
  expect(editor.state.nodes).toMatchObject([{ text: 'First' }, { text: 'Sec' }, { text: 'ond' }]);
  const backspace = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
  handlers.keydown?.(backspace);
  expect(backspace.defaultPrevented).toBe(true);
  expect(editor.state.nodes).toMatchObject([{ text: 'First' }, { text: 'Second' }]);
  editor.commands.undo();
  editor.commands.undo();
  expect(editor.state.nodes).toEqual(before.nodes);
  editor.select(textSelection(1, 5));
  textInput.sync(input);
  input.value += '!';
  input.setSelectionRange(input.value.length, input.value.length);
  handlers.input?.(new Event('input'), input);
  expect(editor.state.nodes[0]).toMatchObject({ text: 'First!' });
  expect(notices.filter(Boolean)).toEqual([]);
});
