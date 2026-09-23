import { createEditor } from '@kerned/core';
import { createSchema } from '@kerned/model';
import type { MountedEditor } from '@kerned/view';
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';

import { note, editing, presentation } from '../../../../tests/consumers/document.js';
import { EditorContent } from '../editor-content.js';

const schema = createSchema({ extensions: [note, editing, presentation] });

const size = { width: 300, height: 300 };

test('EditorContent follows session, width and scrollport changes without unmounting', async ({
  onTestFinished,
}) => {
  function session(body: string) {
    return createEditor({
      schema,
      content: [
        { kind: 'note', body },
        ...Array.from({ length: 20 }, () => ({
          kind: 'note' as const,
          body: 'Scrollable content',
        })),
      ],
    });
  }

  const first = session('Original');
  const second = session('Replacement');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  onTestFinished(() => {
    flushSync(() => root.unmount());
    first.destroy();
    second.destroy();
    host.remove();
  });

  function render(editor: typeof first, scroll: 'container' | 'page', maxWidth = 276) {
    return new Promise<MountedEditor>((resolve, reject) => {
      flushSync(() =>
        root.render(
          <StrictMode>
            <EditorContent
              editor={editor}
              style={size}
              scroll={scroll}
              maxWidth={maxWidth}
              onReady={resolve}
              onError={reject}
            />
          </StrictMode>,
        ),
      );
    });
  }

  function capture() {
    const input = host.querySelector('textarea');

    if (!input) throw new Error('Missing mounted input capture');

    return input;
  }

  const original = await render(first, 'container');
  original.focus();
  const oldInput = capture();
  oldInput.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  const replacement = await render(second, 'container', 172);
  replacement.focus();
  const input = capture();
  expect(original.isDestroyed).toBe(true);
  expect(oldInput.isConnected).toBe(false);
  expect(input).not.toBe(oldInput);
  expect(input.value).toBe('Replacement');
  expect(replacement.getSnapshot()?.viewport.width).toBe(172);
  const point = replacement.coordsAt({ id: second.state.nodes[0].id, offset: 0 });

  if (!point) throw new Error('Missing mounted caret geometry');
  expect(input.getBoundingClientRect().left).toBeCloseTo(point.left, 0);

  // A stale composition completion cannot publish into either session.
  oldInput.value = 'Stale composition';
  oldInput.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  input.value = '!Replacement';
  input.setSelectionRange(1, 1);
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '!' }),
  );
  await expect.poll(() => second.state.nodes[0].body).toBe('!Replacement');
  expect(first.state.nodes[0].body).toBe('Original');
  expect(replacement.getSnapshot()?.viewport.height).toBe(300);

  const page = await render(second, 'page', 172);
  expect(replacement.isDestroyed).toBe(true);
  expect(page.getSnapshot()?.viewport.height).toBe(innerHeight);
  const restored = await render(second, 'container', 172);
  const scroller = host.querySelector('[data-editor-view]');

  if (!(scroller instanceof HTMLElement)) throw new Error('Missing editor scrollport');
  scroller.scrollTop = 75;
  scroller.dispatchEvent(new Event('scroll'));
  await expect.poll(() => restored.getSnapshot()?.viewport.top).toBe(75);
  expect(restored.getSnapshot()?.viewport.height).toBe(300);
  expect(capture().value).toBe('!Replacement');
});
