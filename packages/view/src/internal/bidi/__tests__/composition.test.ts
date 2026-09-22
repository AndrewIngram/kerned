import { expect, test } from 'vitest';

import { packGlyphs } from '../../owned-packed.js';
import { composeParagraph, type ParagraphGlyphs } from '../../owned-paragraph.js';
import { analyzeBidi } from '../paragraph.js';

function compose(text: string, width = 200) {
  const glyphs: ParagraphGlyphs = {
    clusters: Array.from(text, (char, index) => ({
      start: index,
      end: index + 1,
      width: 10,
      stops: [index + 1],
      glyphs: [{ id: char.codePointAt(0) ?? 0, start: index, font: 0, advance: 10, dx: 0, dy: 0 }],
    })),
    breaks: new Set(Array.from(text, (_, index) => index + 1)),
  };

  return composeParagraph(
    glyphs,
    text.length,
    width,
    20,
    15,
    packGlyphs(glyphs),
    'packed',
    analyzeBidi(text),
  );
}

test('mixed text paints clusters in visual order and retains logical offsets', () => {
  const paragraph = compose('ab אבג cd');
  expect(
    paragraph.runs
      .flatMap((run) => Array.from(run.glyphs, (id) => String.fromCodePoint(id)))
      .join(''),
  ).toBe('ab גבא cd');
  expect(paragraph.geometry(3, 3, false).caret[0]).toBe(60);
  expect(paragraph.geometry(3, 3, true).caret[0]).toBe(30);
  expect(paragraph.geometry(0, 4, false).rects).toEqual([
    [0, 0, 30, 20],
    [50, 0, 60, 20],
  ]);
  expect(paragraph.geometry(4, 0, false).rects).toEqual(paragraph.geometry(0, 4, false).rects);
  expect(paragraph.geometry(0, 9, false).rects).toEqual([[0, 0, 90, 20]]);
});

test('arrows follow visual positions while hit testing returns logical carets', () => {
  const paragraph = compose('ab אבג cd');
  const left = paragraph.move(3, false, 'left');
  expect(left.index).toBe(4);
  expect(paragraph.geometry(left.index, left.index, left.upstream).caret[0]).toBe(50);
  const right = paragraph.move(left.index, left.upstream, 'right');
  expect(paragraph.geometry(right.index, right.index, right.upstream).caret[0]).toBe(60);

  for (let x = 0; x <= 90; x += 10) {
    const hit = paragraph.hit(x, 5);
    expect(paragraph.geometry(hit.index, hit.index, hit.upstream).caret[0]).toBe(x);
  }

  expect(paragraph.move(3, false, 'home').index).toBe(0);
  expect(paragraph.move(3, false, 'end').index).toBe(9);
});

test('wrapping reorders each line and preserves both sides of soft breaks', () => {
  const paragraph = compose('אבגד', 20);
  expect(
    paragraph.runs
      .flatMap((run) => Array.from(run.glyphs, (id) => String.fromCodePoint(id)))
      .join(''),
  ).toBe('באדג');
  expect(paragraph.geometry(2, 2, true).caret).toEqual([0, 0, 1, 20]);
  expect(paragraph.geometry(2, 2, false).caret).toEqual([20, 20, 21, 40]);
  const down = paragraph.move(0, false, 'down');
  expect(paragraph.geometry(down.index, down.index, down.upstream).caret).toEqual([20, 20, 21, 40]);
});

test('empty bidi composition has a usable caret', () => {
  const paragraph = compose('');
  expect(paragraph.hit(100, 0).index).toBe(0);
  expect(paragraph.geometry(0, 0, false).caret).toEqual([0, 0, 1, 20]);
});
