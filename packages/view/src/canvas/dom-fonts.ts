import type { createFontCatalog, FontSelection, FontSource } from './font-catalog.js';

/** Each attachment registers private CSS aliases, even when semantic family names coincide. */
export async function createDOMFonts(
  document: Document,
  catalog: ReturnType<typeof createFontCatalog>,
  data: readonly ArrayBuffer[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const prefix = `gprose-${crypto.randomUUID()}`;
  const aliases = new Map<FontSource, string>();
  const faces: FontFace[] = [];
  let emojiFallback = false;

  function destroy() {
    for (const face of faces) document.fonts.delete(face);
    faces.length = 0;
    aliases.clear();
  }

  try {
    for (const [index, source] of catalog.faces.entries()) {
      const alias = `${prefix}-${index}`;

      const face = new FontFace(alias, data[index], {
        weight: String(source.weight),
        style: source.style,
      });

      aliases.set(source, alias);
      faces.push(face);
    }

    await Promise.all(
      faces.map(async (face, index) => {
        try {
          await face.load();
        } catch (error) {
          // The native shaper already accepted these bytes. Some browsers reject
          // bitmap color fonts; only the designated emoji face may use platform fallback.
          if (catalog.faces[index] === catalog.emoji) {
            emojiFallback = true;
            aliases.delete(catalog.emoji);

            return;
          }

          throw new Error(`Browser font loading failed: ${catalog.faces[index].asset}`, {
            cause: error,
          });
        }
      }),
    );
    signal?.throwIfAborted();

    for (const face of faces) if (face.status === 'loaded') document.fonts.add(face);
  } catch (error) {
    destroy();
    throw error;
  }

  return {
    emojiFallback,
    resolve(selection: FontSelection = {}) {
      const source = catalog.select(selection);
      const alias = aliases.get(source);
      const emoji = aliases.get(catalog.emoji);

      const fallback = emojiFallback
        ? '"Apple Color Emoji", "Segoe UI Emoji", emoji'
        : `"${emoji}"`;

      const textFallbacks = catalog.fallbacks(selection).map((face) => `"${aliases.get(face)}"`);

      if (!faces.length || (!alias && source !== catalog.emoji))
        throw new Error('DOM font resources are destroyed');

      return {
        font: { family: source.family, weight: source.weight, style: source.style },
        cssFamily: [alias ? `"${alias}"` : '', ...textFallbacks, fallback]
          .filter(Boolean)
          .join(', '),
      };
    },
    destroy,
  };
}
