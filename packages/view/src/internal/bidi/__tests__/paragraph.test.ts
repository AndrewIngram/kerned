import { expect, test } from 'vitest';

import { analyzeBidi, bidiLine } from '../paragraph.js';
import { getBidiCharType, TYPES } from '../properties.js';

test('supplementary characters are single scalars with UTF-16 positions', () => {
  const analysis = analyzeBidi('a😀𞤀א');
  expect([...analysis.offsets]).toEqual([0, 1, 3, 5, 6]);
  expect([...analysis.levels]).toEqual([0, 0, 1, 1]);
  expect([...bidiLine(analysis, 0, 4).order]).toEqual([0, 1, 3, 2]);
  expect(getBidiCharType(0x1e900)).toBe(TYPES.R);
  // UCD @missing defaults for unassigned Arabic/Hebrew characters.
  expect(getBidiCharType(0x590)).toBe(TYPES.R);
  expect(getBidiCharType(0x10ec0)).toBe(TYPES.AL);
});

test('paragraph direction and formatting state do not bleed across separators', () => {
  const text = 'אב\nabc\n\u202eDEF\nxyz';
  const analysis = analyzeBidi(text);
  expect(analysis.paragraphs.map((paragraph) => paragraph.level)).toEqual([1, 0, 0, 0]);

  for (const paragraph of analysis.paragraphs) {
    const alone = analyzeBidi(
      text.slice(analysis.offsets[paragraph.start], analysis.offsets[paragraph.end + 1]),
    );

    expect(analysis.levels.slice(paragraph.start, paragraph.end + 1)).toEqual(alone.levels);
  }
});

test('line endings reset whitespace without changing retained paragraph analysis', () => {
  const analysis = analyzeBidi('abc אב  גד xyz');
  const retained = analysis.levels.slice();
  const first = bidiLine(analysis, 0, 8);
  expect(first.levels.slice(-2)).toEqual(new Uint8Array([0, 0]));
  expect([...first.order]).toEqual([0, 1, 2, 3, 5, 4, 6, 7]);
  expect(analysis.levels).toEqual(retained);
  expect(() => bidiLine(analyzeBidi('a\nb'), 0, 3)).toThrow(RangeError);
});

test('empty text and explicit base direction remain well defined', () => {
  expect([...bidiLine(analyzeBidi(''), 0, 0).order]).toEqual([]);
  expect(analyzeBidi('123', 'rtl').paragraphs[0].level).toBe(1);
  expect(analyzeBidi('123', 'ltr').paragraphs[0].level).toBe(0);
});

test('long digit runs and overflow-depth isolates resolve without repeated lookahead scans', () => {
  const digits = analyzeBidi('ا' + '1234567890'.repeat(10000));
  expect(digits.levels.length).toBe(100001);
  expect(digits.levels[0]).toBe(1);
  expect(digits.levels.subarray(1).every((level) => level === 2)).toBe(true);
  const nested = analyzeBidi('\u2068'.repeat(10000) + 'א' + '\u2069'.repeat(10000));
  expect(nested.levels.length).toBe(20001);
  expect(nested.levels[10000]).toBe(125);
  const siblings = analyzeBidi('\u2066a\u2069'.repeat(10000));
  expect(siblings.levels.length).toBe(30000);
  expect(siblings.levels.every((level, index) => level === (index % 3 === 1 ? 2 : 0))).toBe(true);
});
