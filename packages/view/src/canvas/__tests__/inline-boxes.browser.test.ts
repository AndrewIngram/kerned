import { expect, test } from 'vitest';

import { createViewResources } from '../resources.js';

test('inline rectangle shape is independent of allocation property order', async ({
  onTestFinished,
}) => {
  const resources = createViewResources();
  onTestFinished(() => resources.destroy());
  await resources.ready;
  const layout = resources.read().layout.createLayout();
  onTestFinished(() => layout.destroy());
  const input = { id: 1, text: 'A\ufffcB', spans: [], width: 300, size: 20, lineHeight: 30 };

  const first = layout.layoutInline({
    ...input,
    atoms: [{ id: 'badge', index: 1, label: 'ABC', width: 76, ascent: 24, descent: 6 }],
  });

  const reordered = layout.layoutInline({
    ...input,
    atoms: [{ width: 76, ascent: 24, descent: 6, label: 'ABC', id: 'badge', index: 1 }],
  });

  expect(reordered.inlineBoxes).toEqual(first.inlineBoxes);
  expect(JSON.stringify(reordered.inlineBoxes)).toBe(JSON.stringify(first.inlineBoxes));
});
