import { expect, test } from 'vitest';

import { readEditorAsset } from '../assets';
import { createDOMFonts } from '../dom-fonts';
import { createFontCatalog } from '../font-catalog';

test('an invalid ordinary browser font fails explicitly without registering a partial collection', async () => {
  const catalog = createFontCatalog();
  const before = [...document.fonts];
  const bytes = catalog.faces.map(() => new Uint8Array([0, 1, 2]).buffer);
  await expect(createDOMFonts(document, catalog, bytes)).rejects.toThrow(
    /Browser font loading failed: fonts\/NotoSans-/,
  );
  expect([...document.fonts]).toEqual(before);
});

test('cancellation after binary fonts start loading cannot register them late', async () => {
  const catalog = createFontCatalog();
  const data = await Promise.all(catalog.faces.map((face) => readEditorAsset(face.asset, {})));
  const before = [...document.fonts];
  const abort = new AbortController();
  const fonts = createDOMFonts(document, catalog, data, abort.signal);
  abort.abort();
  await expect(fonts).rejects.toMatchObject({ name: 'AbortError' });
  expect([...document.fonts]).toEqual(before);
});
