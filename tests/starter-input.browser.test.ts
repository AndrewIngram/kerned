import { createEditor } from '@gprose/core';
import { documentInput } from '@gprose/extension-editing/browser';
import { createSchema } from '@gprose/model';
import { starterExtensions } from '@gprose/starter-kit';
import { TextSelection, textSelection } from '@gprose/state';
import { createTextInput, createKeyboardShortcuts } from '@gprose/view';
import { expect, test, onTestFinished } from 'vitest';

import { createDocumentInput } from '../packages/extension-editing/src/input.js';

function inputSession() {
  let writable = true;
  const schema = createSchema({ extensions: [...starterExtensions, documentInput] });

  const editor = createEditor({
    schema,
    permissions: { access: () => (writable ? 'editable' : 'read-only') },
    content: [
      { kind: 'paragraph', id: 1, text: 'First' },
      { kind: 'paragraph', id: 2, text: 'Second' },
    ],
  });

  const input = document.createElement('textarea');
  const textInput = createTextInput(schema, editor);
  const notices: string[] = [];
  const notice = (message: string) => notices.push(message);

  const { events: handlers } = createDocumentInput({
    editor,
    onEdit() {},
    textInput,
    input: () => input,
    notice,
    closePanel() {},
    escape() {},
    selectAll: () => editor.commands.selectAll(),
    navigate: () => false,
  });

  onTestFinished(() => {
    textInput.destroy();
    editor.destroy();
  });

  return {
    editor,
    input,
    textInput,
    notices,
    handlers,
    setWritable(this: void, value: boolean) {
      writable = value;
    },
  };
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

test('native input groups typing and deletion, isolates composition, and shares keyboard undo', () => {
  const { editor, input, textInput, handlers } = inputSession();
  editor.select(textSelection(1, 5));

  function type(value: string) {
    textInput.sync(input);
    input.value += value;
    input.setSelectionRange(input.value.length, input.value.length);
    handlers.input?.(new Event('input'), input);
  }

  const shortcuts = createKeyboardShortcuts(editor);

  function key(value: string, ctrlKey = false) {
    const event = new KeyboardEvent('keydown', { key: value, ctrlKey, cancelable: true });

    // The mount dispatches extension shortcuts before the text input fallback.
    if (!textInput.composing && !shortcuts(event)) handlers.keydown?.(event);

    return event;
  }

  type('!');
  type('?');
  expect(editor.history.undo).toBe(1);
  textInput.compositionStart();
  type('é');
  expect(key('Enter').defaultPrevented).toBe(false);
  expect(editor.state.nodes).toHaveLength(2);
  textInput.compositionEnd(input);
  expect(editor.history.undo).toBe(2);
  expect(key('z', true).defaultPrevented).toBe(true);
  expect(editor.state.nodes[0]).toMatchObject({ text: 'First!?' });
  key('z', true);
  expect(editor.state.nodes[0]).toMatchObject({ text: 'First' });
  editor.select(textSelection(2, 6));
  key('Backspace');
  key('Backspace');
  expect(editor.state.nodes[1]).toMatchObject({ text: 'Seco' });
  key('z', true);
  expect(editor.state.nodes[1]).toMatchObject({ text: 'Second' });
});

test('rejected native typing restores the capture before a later permitted edit', () => {
  const { editor, input, textInput, handlers, setWritable } = inputSession();
  editor.select(textSelection(1, 5));
  textInput.sync(input);
  const before = editor.state;
  setWritable(false);
  input.value = 'First rejected';
  input.setSelectionRange(input.value.length, input.value.length);
  handlers.input?.(new Event('input'), input);
  expect(editor.state).toBe(before);
  expect(input.value).toBe('First');
  expect(input.selectionStart).toBe(5);
  expect(editor.history.undo).toBe(0);
  setWritable(true);
  input.value = 'First accepted';
  input.setSelectionRange(input.value.length, input.value.length);
  handlers.input?.(new Event('input'), input);
  expect(editor.state.nodes[0]).toMatchObject({ text: 'First accepted' });
  expect(editor.history.undo).toBe(1);
});
