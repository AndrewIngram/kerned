import { test, expect } from 'vitest';

test('React state hook subscribes to a headless editor and unmounts cleanly', async () => {
  const result = await (async () => {
    const { fixture, dispatch, mountStateProbe } = await import('./fixtures/editor-foundation.js');

    const editor = fixture(),
      element = document.createElement('div');

    document.body.append(element);

    const probe = await mountStateProbe(editor, element),
      initial = element.textContent;

    probe.flush(() =>
      dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 0, text: '!' }]),
    );
    const updated = element.textContent;
    probe.unmount();
    dispatch(editor, [{ kind: 'replaceText', id: 3, from: 0, to: 0, text: '!' }]);
    const empty = element.textContent === '';
    element.remove();

    return { initial, updated, empty };
  })();

  expect(result).toEqual({ initial: '0:text', updated: '1:text', empty: true });
});
