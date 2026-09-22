import { expect, test } from 'vitest';

import { boundaries, snapTextOffset, validateTextRange } from '../text.js';

test.each([
  '',
  'ASCII',
  'e\u0301lan',
  '👨‍👩‍👧‍👦!',
  'a\r\nb',
  '🇬🇧🇫🇷',
  'क्‍ष',
  '\u0600abc',
  'ab\u0301cd',
  'ab\u200dcd',
  '\r\na\n\rb\t\u0000c',
])('range validation agrees with segmentation for %s', (text) => {
  const stops = new Set(boundaries(text));

  const valid: [number, number][] = [];
  const invalid: [number, number][] = [];

  for (let from = -1; from <= text.length + 1; from++) {
    for (let to = -1; to <= text.length + 1; to++) {
      (from <= to && stops.has(from) && stops.has(to) ? valid : invalid).push([from, to]);
    }
  }

  for (const [from, to] of valid) expect(() => validateTextRange(text, from, to)).not.toThrow();

  for (const [from, to] of invalid)
    expect(() => validateTextRange(text, from, to)).toThrow(/grapheme/);

  for (let offset = 0; offset <= text.length; offset++) {
    expect(snapTextOffset(text, offset, -1)).toBe([...stops].findLast((stop) => stop <= offset));
    expect(snapTextOffset(text, offset, 1)).toBe([...stops].find((stop) => stop >= offset));
  }

  expect(() => validateTextRange(text, 0, NaN)).toThrow(/grapheme/);
  expect(() => validateTextRange(text, 0.5, 1)).toThrow(/grapheme/);
});
