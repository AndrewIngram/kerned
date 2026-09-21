import { expect, test } from 'vitest';

import { createFontCatalog, defaultFonts, type FontConfiguration } from '../font-catalog';

test('font matching is independent of face order and uses case-insensitive family names', () => {
  const catalog = createFontCatalog({ ...defaultFonts, faces: defaultFonts.faces.toReversed() });
  expect(catalog.select()).toEqual(defaultFonts.faces[0]);
  expect(catalog.select({ family: 'noto sans', weight: 700, style: 'italic' })).toEqual(
    defaultFonts.faces[3],
  );
  expect(catalog.emoji).toEqual(defaultFonts.faces[4]);
  expect(catalog.select({ family: 'Unavailable', weight: 700 })).toEqual(defaultFonts.faces[1]);
});

test.each([
  [350, [200, 400], 200],
  [400, [300, 500], 500],
  [450, [400, 500], 500],
  [450, [400, 600], 400],
  [500, [400, 600], 400],
  [550, [500, 900], 900],
  [900, [400, 700], 700],
])('weight %s follows CSS static face matching', (requested, weights, expected) => {
  const catalog = createFontCatalog({
    defaultFamily: 'Body',
    emojiFamily: defaultFonts.emojiFamily,
    faces: [
      defaultFonts.faces[4],
      ...weights.map((weight) => ({ ...defaultFonts.faces[0], family: 'Body', weight })),
    ],
  });

  expect(catalog.select({ weight: requested }).weight).toBe(expected);
});

test('style matching precedes weight matching without inventing synthetic faces', () => {
  const catalog = createFontCatalog({
    ...defaultFonts,
    faces: [defaultFonts.faces[0], defaultFonts.faces[3], defaultFonts.faces[4]],
  });

  expect(catalog.select({ style: 'italic' })).toEqual(defaultFonts.faces[3]);
  expect(catalog.select({ weight: 700 })).toEqual(defaultFonts.faces[0]);
});

test('font configuration is validated and detached from mutable caller data', () => {
  const faces = defaultFonts.faces.map((entry) => ({ ...entry }));
  const configuration: FontConfiguration = { ...defaultFonts, faces };
  const catalog = createFontCatalog(configuration);
  faces[0].family = 'Changed';
  expect(catalog.select().family).toBe('Noto Sans');
  expect(Object.isFrozen(catalog.faces)).toBe(true);
  expect(Object.isFrozen(catalog.select())).toBe(true);
  expect(() => createFontCatalog({ ...defaultFonts, faces: [] })).toThrow(/Too small/);
  expect(() =>
    createFontCatalog({
      ...defaultFonts,
      faces: Array.from({ length: 257 }, () => defaultFonts.faces[0]),
    }),
  ).toThrow(/Too big/);
  expect(() => createFontCatalog({ ...defaultFonts, defaultFamily: 'Missing' })).toThrow(
    /registered/,
  );
  expect(() =>
    createFontCatalog({ ...defaultFonts, faces: [...defaultFonts.faces, defaultFonts.faces[0]] }),
  ).toThrow(/Duplicate/);
  expect(() => catalog.select({ weight: NaN })).toThrow(/Invalid input/);
  expect(() => catalog.select({ weight: 1001 })).toThrow(/Too big/);
});
