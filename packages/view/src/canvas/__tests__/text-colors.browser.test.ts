import { expect, test } from 'vitest';

import { createTextColors } from '../text-colors.js';

test('standalone CSS colors resolve consistently to browser CSS and canvas channels and are cached', () => {
  const colors = createTextColors(document);
  const red = colors('hsl(0, 100%, 50%)');
  expect([...red.canvas]).toEqual([1, 0, 0, 1]);
  expect(red.css).toBe('rgba(255, 0, 0, 1)');
  expect(colors('hsl(0, 100%, 50%)')).toBe(red);
  expect([...colors('rebeccapurple').canvas]).toEqual([...new Float32Array([0.4, 0.2, 0.6, 1])]);
  expect(colors('rgba(0, 0, 255, 0.5)').canvas[3]).toBeCloseTo(0.5, 2);
  expect([...colors('transparent').canvas]).toEqual([0, 0, 0, 0]);
  expect(() => colors('not-a-color')).toThrow(/Invalid text color/);
  expect(() => colors('var(--text-color)')).toThrow(/standalone CSS color/);
  expect(() => colors('currentColor')).toThrow(/standalone CSS color/);
});
