import { test, expect } from 'vitest';

test('text capture reuses the document index while the caret moves and refreshes it after edits', async () => {
  const result = await (async () => {
    const { fixture, schema, dispatch } =
      await import('../../../../../tests/fixtures/editor-foundation.js');

    const { textSelection, selectionContext } = await import('@kerned/state');
    const { createTextInput } = await import('@kerned/view');
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
