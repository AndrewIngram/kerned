import { expect, test } from 'vitest';

import { analyzeBidi } from '../bidi/paragraph.js';
import { directionalRuns } from '../directional-runs.js';

const fonts = {
  marked: ({ bold, italic }: { bold: boolean; italic: boolean }) =>
    Number(bold) + 2 * Number(italic),
  covering: (id: number) => id,
  emoji: 9,
};

test('overlapping, unsorted marks retain active styles after an inner mark ends', () => {
  const text = 'אבגדהוזחטיכל';

  const spans = [
    { start: 4, end: 6, bold: true, italic: false },
    { start: 3, end: 8, bold: false, italic: true },
    { start: 1, end: 7, bold: true, italic: false },
    { start: 7, end: 9, bold: true, italic: false },
    { start: 10, end: 10, bold: true, italic: true },
  ];

  const bidi = analyzeBidi(text);
  const whole = directionalRuns(text, spans, bidi, fonts);
  expect(whole.map(({ start, end, font }) => [start, end, font])).toEqual([
    [0, 1, 0],
    [1, 3, 1],
    [3, 8, 3],
    [8, 9, 1],
    [9, 12, 0],
  ]);
  const slice = directionalRuns(text, spans, bidi, fonts, 5, 10);
  expect(slice.map(({ start, end, font }) => [start, end, font])).toEqual([
    [5, 8, 3],
    [8, 9, 1],
    [9, 10, 0],
  ]);
});

test('many adjacent marked ranges are visited without rescanning their boundaries per grapheme', () => {
  const text = 'אב'.repeat(2000);
  let reads = 0;

  const spans = Array.from({ length: 2000 }, (_, i) => ({
    get start() {
      reads++;

      return i * 2;
    },
    get end() {
      reads++;

      return i * 2 + 1;
    },
    bold: true,
    italic: false,
  }));

  const runs = directionalRuns(text, spans, analyzeBidi(text), fonts);
  expect(runs).toHaveLength(text.length);
  expect(
    runs.every(
      (run, i) => run.start === i && run.end === i + 1 && run.font === Number(i % 2 === 0),
    ),
  ).toBe(true);
  expect(reads).toBeLessThanOrEqual(spans.length * 4);
});
