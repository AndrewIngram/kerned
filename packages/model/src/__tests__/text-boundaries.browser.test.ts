import { expect, test } from 'vitest';

import { boundaries, snapTextOffset, validateTextRange } from '../text.js';

function acceptsRange(text: string, offset: number) {
  try {
    validateTextRange(text, offset, offset);

    return true;
  } catch {
    return false;
  }
}

test.each(['A😀e\u0301Z', 'x👨‍👩‍👧‍👦y', 'a🇬🇧b', 'a𞤀𞤁b', 'aאב\u05b0بّ'])(
  'native offset lookup agrees with grapheme iteration for %s',
  (text) => {
    const stops = boundaries(text);

    for (let offset = 0; offset <= text.length; offset++) {
      const before = stops.findLast((stop) => stop <= offset);
      const after = stops.find((stop) => stop >= offset);
      expect(snapTextOffset(text, offset, -1)).toBe(before);
      expect(snapTextOffset(text, offset, 1)).toBe(after);

      expect(acceptsRange(text, offset)).toBe(stops.includes(offset));
    }
  },
);
