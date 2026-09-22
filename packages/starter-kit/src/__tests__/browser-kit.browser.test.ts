import { createEditor } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { selectionContext } from '@gprose/state';
import { expect, test } from 'vitest';

import { createNodeViews } from '../../../view/src/browser/node-views.js';
import { starterBrowserExtensions } from '../browser.js';

function host() {
  const element = document.createElement('div');
  element.style.width = '240px';
  document.body.append(element);

  return element;
}

test('the browser kit supplies images without a separate renderer list and destroys pending images with the session', async ({
  onTestFinished,
}) => {
  const editor = createEditor({
    schema: createSchema({ extensions: starterBrowserExtensions({ imageDelay: 20 }) }),
    content: [
      {
        kind: 'image',
        src:
          'data:image/svg+xml,' +
          encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"/>'),
        alt: 'Illustration',
      },
    ],
  });

  const collection = createNodeViews(editor, { clipboard() {}, notice() {} });
  const element = host();
  onTestFinished(() => {
    editor.destroy();
    element.remove();
  });
  const node = editor.state.nodes[0];
  const renderer = collection.find(node);

  if (!renderer) throw new Error('Missing image view');
  const view = renderer.mount(element);
  view.update({
    node,
    selection: editor.state.selection,
    context: selectionContext(editor.schema, editor.state.nodes),
    width: 240,
    onMeasure: () => {},
  });
  expect(element.textContent).toBe('Loading illustration…');
  await expect.poll(() => element.style.height).toBe('120px');
  expect(element.querySelector('img')?.alt).toBe('Illustration');
  view.destroy();
  const other = createNodeViews(editor, { clipboard() {}, notice() {} }).find(node);

  if (!other) throw new Error('Missing second image view');
  const pending = other.mount(element);
  pending.update({
    node,
    selection: editor.state.selection,
    context: selectionContext(editor.schema, editor.state.nodes),
    width: 240,
    onMeasure: () => {},
  });
  expect(element.textContent).toBe('Loading illustration…');
  editor.destroy();
  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  expect(element.textContent).toBe('');
  expect(element.querySelector('img')).toBeNull();
});
