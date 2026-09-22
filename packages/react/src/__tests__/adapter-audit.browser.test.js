import { test, expect } from 'vitest';

test('canvas input follows session, inset and scrollport changes without remounting', async () => {
  const result = await (async () => {
    const { fixture, dispatch } = await import('../../../../tests/fixtures/editor-foundation.js');

    const { mountCanvasInputProbe } =
      await import('../../../../tests/fixtures/canvas-input-probe.js');

    const first = fixture(),
      second = fixture();

    dispatch(second, [{ kind: 'replaceText', id: 3, from: 0, to: 13, text: 'Replacement' }]);
    const host = document.createElement('div');
    document.body.append(host);

    const probe = await mountCanvasInputProbe(host, first),
      textarea = host.querySelector('textarea');

    const oldInput = probe.current.textInput;
    oldInput.compositionStart();
    probe.update({ editor: second, inset: 64 });

    const value = textarea.value,
      oldComposition = oldInput.composing,
      newComposition = probe.current.textInput.composing;

    const inset =
      Number.parseFloat(textarea.style.left) -
      host.querySelector('canvas').getBoundingClientRect().left;

    textarea.value = '!Replacement';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const embedded = probe.current.viewport.viewportHeight;
    probe.update({ page: true });
    const pageHeight = probe.current.viewport.viewportHeight;
    probe.update({ page: false });
    host.firstChild.scrollTop = 75;
    host.firstChild.dispatchEvent(new Event('scroll'));
    await expect.poll(() => probe.current.viewport.scroll).toBe(75);

    const restored = {
      height: probe.current.viewport.viewportHeight,
      scroll: probe.current.viewport.scroll,
    };

    const changes = probe.changes;
    probe.unmount();
    host.remove();

    return {
      value,
      oldComposition,
      newComposition,
      inset,
      embedded,
      pageHeight,
      expectedPageHeight: innerHeight,
      restored,
      changes,
    };
  })();

  expect(result.value).toBe('Replacement');
  expect(result.oldComposition).toBe(false);
  expect(result.newComposition).toBe(false);
  expect(result.inset).toBe(69);
  expect(result.embedded).toBe(100);
  expect(result.pageHeight).toBe(result.expectedPageHeight);
  expect(result.restored).toEqual({ height: 100, scroll: 75 });
  expect(result.changes).toEqual([[0, 0, '!']]);
});

test('text capture reuses the document index while the caret moves and refreshes it after edits', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch } =
      await import('../../../../tests/fixtures/editor-foundation.js');

    const { textSelection, selectionContext } = await import('@gprose/state');
    const { createTextInput } = await import('@gprose/view');
    const editor = fixture();
    let visits = 0;

    const measuredSchema = {
      ...schema,
      children(node) {
        visits++;

        return schema.children(node);
      },
    };

    const input = document.createElement('textarea'),
      capture = createTextInput(measuredSchema, editor);

    capture.sync(input);
    const initial = visits;

    for (const offset of [1, 2, 3]) {
      editor.select(textSelection(3, offset));
      capture.sync(input);
    }

    const afterMovement = visits;
    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 0, text: '!' }]);
    capture.sync(input);

    const refreshed = visits > afterMovement,
      value = input.value;

    const context = selectionContext(measuredSchema, editor.state.nodes);
    visits = 0;
    createTextInput(measuredSchema, editor, () => context).sync(input);

    return { initial, afterMovement, refreshed, value, sharedVisits: visits };
  })();

  expect(result.initial).toBeGreaterThan(0);
  expect(result.afterMovement).toBe(result.initial);
  expect(result.refreshed).toBe(true);
  expect(result.value).toBe('!Alpha 😀 beta');
  expect(result.sharedVisits).toBe(0);
});
