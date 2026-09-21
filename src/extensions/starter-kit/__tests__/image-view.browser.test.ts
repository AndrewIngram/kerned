import { expect, test } from 'vitest';

import { createImageRenderer, type ImageFrame } from '../image-view';

function source(width: number, height: number) {
  return (
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`,
    )
  );
}

function frame(src: string, onMeasure: ImageFrame['onMeasure']): ImageFrame {
  return {
    node: { kind: 'image', id: 1, key: 'image-1', src, alt: 'Original' },
    width: 240,
    onMeasure,
  };
}

function host() {
  const element = document.createElement('div');
  element.style.width = '240px';
  document.body.append(element);

  return element;
}

test('native image view decodes, measures and updates source, dimensions and alternative text', async ({
  onTestFinished,
}) => {
  const element = host();
  const view = createImageRenderer()(element);
  const sizes: number[][] = [];
  const first = frame(source(400, 200), (...size) => sizes.push(size));
  onTestFinished(() => {
    view.destroy();
    element.remove();
  });
  view.update(first);
  expect(element.textContent).toBe('Loading illustration…');
  await expect.poll(() => element.style.height).toBe('120px');
  expect(element.querySelector('img')?.alt).toBe('Original');
  expect(sizes).toContainEqual([1, 240, 120]);
  view.update({ ...first, width: 120, node: { ...first.node, alt: 'Renamed' } });
  expect(element.style.height).toBe('60px');
  expect(element.querySelector('img')?.alt).toBe('Renamed');
  expect(sizes).toContainEqual([1, 120, 60]);
  view.update({ ...first, node: { ...first.node, id: 2, key: 'image-2', src: source(100, 200) } });
  expect(element.style.height).toBe('96px');
  expect(element.querySelector('img')).toBeNull();
  await expect.poll(() => element.style.height).toBe('480px');
  expect(element.dataset.image).toBe('2');
  expect(sizes).toContainEqual([2, 240, 480]);
});

test('failed images recover when their source changes', async ({ onTestFinished }) => {
  const element = host();
  const view = createImageRenderer()(element);
  const broken = frame('data:image/png;base64,invalid', () => {});
  onTestFinished(() => {
    view.destroy();
    element.remove();
  });
  view.update(broken);
  await expect.poll(() => element.textContent).toBe('Image unavailable');
  view.update({ ...broken, node: { ...broken.node, src: source(200, 50) } });
  expect(element.textContent).toBe('Loading illustration…');
  await expect.poll(() => element.style.height).toBe('60px');
  expect(element.querySelector('img')?.naturalWidth).toBe(200);
});

test('reuses decoded dimensions within one renderer and isolates independent editors', async ({
  onTestFinished,
}) => {
  const element = host();
  const other = host();
  const renderer = createImageRenderer();
  const original = renderer(element);
  const value = frame(source(300, 100), () => {});
  original.update(value);
  await expect.poll(() => element.style.height).toBe('80px');
  original.destroy();
  const replacement = renderer(element);
  const independent = createImageRenderer({ delay: 30 })(other);
  onTestFinished(() => {
    replacement.destroy();
    independent.destroy();
    element.remove();
    other.remove();
  });
  replacement.update(value);
  expect(element.style.height).toBe('80px');
  expect(element.querySelector('img')).not.toBeNull();
  independent.update(value);
  expect(other.style.height).toBe('96px');
  original.destroy();
  expect(element.style.height).toBe('80px');
  await expect.poll(() => other.style.height).toBe('80px');
});

test('obsolete loading and destruction cannot mutate a successor or publish measurements', async ({
  onTestFinished,
}) => {
  const element = host();
  const renderer = createImageRenderer({ delay: 25 });
  const view = renderer(element);
  let oldMeasurements = 0;
  const old = frame(source(400, 200), () => oldMeasurements++);
  view.update(old);
  view.update({ ...old, node: { ...old.node, src: source(20, 400) } });
  view.destroy();
  const count = oldMeasurements;
  const successor = renderer(element);
  onTestFinished(() => {
    successor.destroy();
    element.remove();
  });
  successor.update(frame(source(600, 100), () => {}));
  expect(() => view.update(old)).toThrow(/destroyed/);
  view.destroy();
  await expect.poll(() => element.style.height).toBe('40px');
  expect(element.querySelector('img')?.naturalWidth).toBe(600);
  expect(oldMeasurements).toBe(count);
  successor.destroy();
  expect(element.childNodes).toHaveLength(0);
  expect(element.dataset.image).toBeUndefined();
  expect(element.style.height).toBe('');
});

test('removal after decode starts leaves no late DOM or observer work', async ({
  onTestFinished,
}) => {
  const element = host();
  const renderer = createImageRenderer();
  const view = renderer(element);
  let reports = 0;
  const value = frame(source(1024, 768), () => reports++);
  onTestFinished(() => {
    view.destroy();
    element.remove();
  });
  view.update(value);
  // The decoder's zero-delay task was queued first, so it has started by this callback.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  view.destroy();
  const count = reports;
  element.textContent = 'New owner';
  element.style.height = '10px';
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(element.textContent).toBe('New owner');
  expect(element.style.height).toBe('10px');
  expect(reports).toBe(count);
});
