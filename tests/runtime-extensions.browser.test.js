import { test, expect } from 'vitest';

test('React selectors suppress unchanged values and view listeners clean up under StrictMode', async () => {
  const result = await (async () => {
    const { fixture, dispatch, mountOptimizedProbe } =
      await import('./fixtures/editor-foundation.js');

    const { textSelection } = await import('../src/editor/index.ts');

    const editor = fixture(),
      element = document.createElement('div');

    document.body.append(element);

    const probe = await mountOptimizedProbe(editor, element),
      before = { ...probe.counts };

    probe.flush(() => editor.select(textSelection(3, 1)));
    const same = { ...probe.counts };
    probe.flush(() =>
      dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 0, text: '!' }]),
    );
    const changed = { ...probe.counts };

    const input = element.querySelector('textarea'),
      surface = element.firstElementChild;

    input.dispatchEvent(new Event('input', { bubbles: true }));
    element.querySelector('button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const interactive = probe.counts.pointer;
    surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    const pointer = probe.counts.pointer;
    probe.unmount();
    surface.append(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    element.remove();

    return { before, same, changed, interactive, pointer, final: probe.counts };
  })();

  expect(result.same.revision).toBe(result.before.revision);
  expect(result.same.selection).toBe(result.before.selection);
  expect(result.changed.revision).toBeGreaterThan(result.same.revision);
  expect(result.changed.selection).toBe(result.same.selection);
  expect(result.interactive).toBe(0);
  expect(result.pointer).toBe(1);
  expect(result.final.pointer).toBe(1);
  expect(result.final.input).toBe(1);
});

test('framework-free text capture handles a foreign schema and nested selection', async () => {
  const result = await (async () => {
    const { fixture, schema } = await import('./fixtures/editor-foundation.js');
    const { TextSelection, textSelection } = await import('../src/editor/index.ts');
    const { createTextInput } = await import('../src/editor-browser/index.ts');

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
