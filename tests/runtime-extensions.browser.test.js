import { test, expect } from 'vitest';

test('framework-free text capture handles a foreign schema and nested selection', async () => {
  const result = await (async () => {
    const { fixture, schema } = await import('./fixtures/editor-foundation.js');
    const { TextSelection, textSelection } = await import('@gprose/state');
    const { createTextInput } = await import('@gprose/view');

    const editor = fixture(),
      input = document.createElement('textarea'),
      capture = createTextInput(schema, editor);

    document.body.append(input);
    let all = 0;

    const dispose = capture.mount(input, () => all++),
      changes = [];

    editor.select(textSelection(3, 2, 5));
    capture.sync(input);
    const selected = [input.value, input.selectionStart, input.selectionEnd];
    input.value = 'AlX 😀 beta';
    capture.read(input, (...args) => changes.push(args));
    editor.select(new TextSelection({ id: 15, offset: 1 }, { id: 8, offset: 0 }));
    capture.sync(input);
    input.value = 'replacement';
    capture.read(input, (...args) => changes.push(args));
    capture.compositionStart();
    const composing = capture.composing;
    capture.compositionEnd(input);
    dispose();
    const ended = !capture.composing;
    input.dispatchEvent(new Event('select'));
    input.remove();

    return { selected, changes, composing, ended, all };
  })();

  expect(result.selected).toEqual(['Alpha 😀 beta', 2, 5]);
  expect(result.changes).toEqual([
    [2, 5, 'X'],
    [0, 0, 'replacement'],
  ]);
  expect(result.composing && result.ended).toBe(true);
  expect(result.all).toBe(0);
});
