import { expect, test } from 'vitest';

import { observeEditorViewport, type EditorViewport } from '../viewport';

test('observes real scrollport geometry, scrolling and resizing, then releases listeners', async ({
  onTestFinished,
}) => {
  const scrollport = document.createElement('div');
  scrollport.style.cssText = 'width: 320px; height: 160px; overflow: auto;';
  const element = document.createElement('div');
  element.style.cssText = 'height: 1000px; width: 100%;';
  const toolbar = document.createElement('div');
  toolbar.style.height = '24px';
  scrollport.append(element);
  document.body.append(toolbar, scrollport);
  onTestFinished(() => {
    toolbar.remove();
    scrollport.remove();
  });
  const changes: EditorViewport[] = [];

  const dispose = observeEditorViewport({
    element,
    scrollport,
    toolbar,
    onChange: (viewport) => changes.push(viewport),
  });

  onTestFinished(dispose);
  expect(changes.at(-1)).toEqual({
    width: element.clientWidth,
    height: 160,
    inset: 24,
    scrollTop: 0,
  });
  scrollport.scrollTop = 70;
  await expect.poll(() => changes.at(-1)?.scrollTop).toBe(70);
  toolbar.style.height = '40px';
  await expect.poll(() => changes.at(-1)?.inset).toBe(40);
  scrollport.style.height = '200px';
  await expect.poll(() => changes.at(-1)?.height).toBe(200);
  dispose();
  dispose();
  const count = changes.length;
  scrollport.dispatchEvent(new Event('scroll'));
  expect(changes).toHaveLength(count);
});
