import { expect, test } from 'vitest';

import { createContentSlot, type SlotInsets } from '../content-slot.js';

test('slot ownership measures chrome in document units and releases old attachments without affecting successors', async ({
  onTestFinished,
}) => {
  const root = document.createElement('div');
  root.style.cssText =
    'display:flow-root;box-sizing:border-box;width:300px;padding:20px 12px 8px 16px;transform:scale(1.25);transform-origin:0 0';
  const body = document.createElement('div');
  body.style.height = '7px';
  root.append(body);
  document.body.append(root);
  const values: SlotInsets[] = [];
  const errors: Error[] = [];

  const owner = createContentSlot({
    root,
    measure: (value) => values.push(value),
    onError: (error) => errors.push(error),
  });

  onTestFinished(() => {
    owner.destroy();
    root.remove();
  });
  owner.update(300, 100);
  const release = owner.content.attach(body);
  expect(() => owner.content.attach(body)).toThrow('already attached');
  await expect.poll(() => values).toEqual([{ top: 20, right: 12, bottom: 8, left: 16 }]);
  owner.update(300, 200);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(values).toHaveLength(1);
  expect(body.style.height).toBe('200px');
  release();
  expect(body.style.height).toBe('7px');
  const next = owner.content.attach(body);
  release();
  expect(body.style.height).toBe('200px');
  root.style.paddingTop = '36px';
  await expect.poll(() => values.at(-1)?.top).toBe(36);
  // Redistribute chrome without changing either observed rectangle's size.
  root.style.paddingTop = '40px';
  root.style.paddingBottom = '4px';
  await expect.poll(() => values.at(-1)?.top).toBe(40);
  expect(values.at(-1)?.bottom).toBe(4);
  owner.destroy();
  next();
  expect(body.style.height).toBe('7px');
  expect(() => owner.content.attach(body)).toThrow('destroyed');
  expect(errors).toEqual([]);
});

test('a slot rejects foreign elements and reports content outside its renderer', async ({
  onTestFinished,
}) => {
  const root = document.createElement('div');
  root.style.cssText = 'width:200px;display:flow-root';
  const body = document.createElement('div');
  body.style.marginLeft = '-10px';
  root.append(body);
  document.body.append(root);
  const errors: Error[] = [];
  const owner = createContentSlot({ root, measure() {}, onError: (error) => errors.push(error) });
  onTestFinished(() => {
    owner.destroy();
    root.remove();
  });
  expect(() => owner.content.attach(document.createElement('div'))).toThrow('inside');
  owner.update(200, 40);
  owner.content.attach(body);
  await expect.poll(() => errors[0]?.message).toContain('fit within');
});
