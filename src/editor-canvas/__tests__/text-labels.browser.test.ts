import { afterAll, beforeAll, expect, test } from 'vitest';

import { createViewResources } from '../resources';
import { createTextLabels } from '../text-labels';

const resources = createViewResources();

beforeAll(async () => {
  await resources.ready;
});

afterAll(() => resources.destroy());

test('labels reuse shaping across node-view lifetimes and distinguish text, size and width', () => {
  const engine = resources.read().layout;
  const labels = createTextLabels(engine);
  const value = { text: '@Maya Chen', width: 120, size: 18 };
  const initial = labels(value);
  const calls = engine.stats.glyphCalls;
  expect(labels({ ...value })).toBe(initial);
  expect(engine.stats.glyphCalls).toBe(calls);
  const narrow = labels({ ...value, width: 40 });
  expect(narrow.height).toBeGreaterThan(initial.height);
  expect(labels({ ...value, text: '@Other person' })).not.toBe(initial);
  expect(labels({ ...value, size: 24 })).not.toBe(initial);
  const afterVariants = engine.stats.glyphCalls;
  expect(labels(value)).toBe(initial);
  expect(engine.stats.glyphCalls).toBe(afterVariants);

  const otherEditor = createTextLabels(engine);
  expect(otherEditor(value)).not.toBe(initial);
  expect(engine.stats.glyphCalls).toBeGreaterThan(afterVariants);
});

test('label retention is bounded, preserves recently used entries and leaves evicted snapshots readable', () => {
  const engine = resources.read().layout;
  const labels = createTextLabels(engine);
  const first = { text: 'Label 0', width: 120, size: 18 };
  const second = { ...first, text: 'Label 1' };
  const original = labels(first);
  const evicted = labels(second);
  const geometry = evicted.geometry(0, 3, false);

  for (let index = 2; index < 128; index++) labels({ ...first, text: `Label ${index}` });
  expect(labels(first)).toBe(original);
  labels({ ...first, text: 'One more label' });
  const calls = engine.stats.glyphCalls;
  expect(labels(first)).toBe(original);
  expect(engine.stats.glyphCalls).toBe(calls);
  expect(labels(second)).not.toBe(evicted);
  expect(engine.stats.glyphCalls).toBeGreaterThan(calls);
  expect(evicted.geometry(0, 3, false)).toEqual(geometry);
});
