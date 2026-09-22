import type { CanvasKit, Font, Typeface } from 'canvaskit-wasm';

import type { createFontCatalog, FontSelection, FontSource } from './font-catalog.js';

type Catalog = ReturnType<typeof createFontCatalog>;

/** One view owns matching native shaping/drawing faces and their sized font objects. */
export function createNativeFonts(
  kit: CanvasKit,
  catalog: Catalog,
  data: readonly ArrayBuffer[],
  register: (bytes: ArrayBuffer) => number,
) {
  const ids = new Map<FontSource, number>();
  const faces = new Map<number, Typeface>();
  const fonts = new Map<string, Font>();
  const sources = new Map<number, FontSource>();
  const coverage = new Map<number, Map<number, boolean>>();

  function destroy() {
    for (const value of fonts.values()) value.delete();
    fonts.clear();

    for (const value of faces.values()) value.delete();
    faces.clear();
    ids.clear();
    sources.clear();
    coverage.clear();
  }

  try {
    for (const [index, source] of catalog.faces.entries()) {
      const bytes = data[index];
      const id = register(bytes);

      if (!Number.isSafeInteger(id) || id < 0 || id > 255 || faces.has(id))
        throw new Error('Font registration failed');
      const face = kit.Typeface.MakeFreeTypeFaceFromData(bytes);

      if (!face) throw new Error('Skia font registration failed');
      faces.set(id, face);
      ids.set(source, id);
      sources.set(id, source);
    }
  } catch (error) {
    destroy();
    throw error;
  }

  function identity(source: FontSource) {
    const value = ids.get(source);

    if (value === undefined) throw new Error('Font resources are destroyed');

    return value;
  }

  function resolve(selection: FontSelection = {}) {
    const normal = identity(catalog.select(selection));

    const bold = identity(
      catalog.select({ ...selection, weight: Math.max(700, selection.weight ?? 400) }),
    );

    const italic = identity(catalog.select({ ...selection, style: 'italic' }));

    const boldItalic = identity(
      catalog.select({
        ...selection,
        weight: Math.max(700, selection.weight ?? 400),
        style: 'italic',
      }),
    );

    return { normal, bold, italic, boldItalic, key: `${normal}/${bold}/${italic}/${boldItalic}` };
  }

  const defaults = resolve();

  function font(id: number, size: number) {
    const key = `${id}:${size}`;
    let value = fonts.get(key);

    if (!value) {
      const face = faces.get(id);

      if (!face) throw new Error('Font resources are destroyed');
      value = new kit.Font(face, size);
      value.setSubpixel(true);
      fonts.set(key, value);
    }

    return value;
  }

  function covers(id: number, text: string) {
    let known = coverage.get(id);

    if (!known) {
      known = new Map();
      coverage.set(id, known);
    }

    for (const char of text) {
      if (/\p{Default_Ignorable_Code_Point}/u.test(char)) continue;
      const point = char.codePointAt(0) ?? 0;
      let supported = known.get(point);

      if (supported === undefined) {
        supported = font(id, 16).getGlyphIDs(char)[0] !== 0;
        known.set(point, supported);
      }

      if (!supported) return false;
    }

    return true;
  }

  return {
    defaults,
    resolve,
    emoji: identity(catalog.emoji),
    covering(this: void, id: number, text: string) {
      const source = sources.get(id);

      if (!source) throw new Error('Font resources are destroyed');

      if (covers(id, text)) return id;

      for (const fallback of catalog.fallbacks({ weight: source.weight, style: source.style })) {
        const candidate = identity(fallback);

        if (covers(candidate, text)) return candidate;
      }

      return undefined;
    },
    font,
    destroy,
  };
}

export type TextFaces = ReturnType<ReturnType<typeof createNativeFonts>['resolve']>;

export function markedFont(faces: TextFaces, marks: { bold: boolean; italic: boolean }) {
  return marks.bold
    ? marks.italic
      ? faces.boldItalic
      : faces.bold
    : marks.italic
      ? faces.italic
      : faces.normal;
}
