import { expect, test } from 'vitest';

import { mountInlineConsumer } from '../../../../tests/consumers/inline.js';

test('starter paragraphs and headings allocate custom inline definitions alongside mentions', async ({
  onTestFinished,
}) => {
  const host = document.createElement('div');
  host.style.cssText = 'width:500px;height:400px';
  document.body.append(host);
  const { editor, view } = mountInlineConsumer(host, 114);
  onTestFinished(() => {
    editor.destroy();
    host.remove();
  });
  await view.ready;
  const badges = host.querySelectorAll<HTMLElement>('[data-badge]');
  expect(badges).toHaveLength(2);
  expect(host.querySelectorAll('[data-mention]')).toHaveLength(2);

  for (const badge of badges) {
    expect(badge.textContent).toBe('ABC');
    expect(badge.dataset.width).toBe('114');
    expect(badge.getBoundingClientRect().width).toBeCloseTo(114, 1);
  }

  for (const node of editor.state.nodes) {
    const before = view.coordsAt({ id: node.id, offset: 1 });
    const after = view.coordsAt({ id: node.id, offset: 2 });

    if (!before || !after) throw new Error('Missing inline caret geometry');
    expect(after.left - before.left).toBeCloseTo(114, 1);
  }
});
