import { test, expect } from 'vitest';

test('React selectors suppress unchanged values and view listeners clean up under StrictMode', async () => {
  const result = await (async () => {
    const { fixture, dispatch } =
      await import('../../../../../tests/fixtures/editor-foundation.js');

    const { mountOptimizedProbe } = await import('./react-events-probe.js');

    const { textSelection } = await import('@kerned/state');

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
