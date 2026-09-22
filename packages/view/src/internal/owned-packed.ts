import type { ParagraphGlyphs } from './owned-paragraph.js';

// Experimental structure-of-arrays view, prepared once per shaped paragraph.
// Float64 preserves the existing positioning arithmetic; Float32 is used only
// for the renderer's final coordinates. This is scalar JavaScript, not SIMD.
export function packGlyphs(paragraphGlyphs: ParagraphGlyphs) {
  const count = paragraphGlyphs.clusters.reduce((n, c) => n + c.glyphs.length, 0);
  const starts = new Uint32Array(paragraphGlyphs.clusters.length + 1);
  const fonts = new Uint8Array(count);
  const slots = new Uint32Array(count);
  const advance = new Float64Array(count);
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);

  const counts = new Uint32Array(
    paragraphGlyphs.clusters.reduce(
      (max, cluster) => cluster.glyphs.reduce((n, glyph) => Math.max(n, glyph.font + 1), max),
      0,
    ),
  );

  for (const cluster of paragraphGlyphs.clusters)
    for (const glyph of cluster.glyphs) counts[glyph.font]++;
  const ids = Array.from(counts, (n) => new Uint16Array(n));
  counts.fill(0);
  let index = 0;
  paragraphGlyphs.clusters.forEach((cluster, c) => {
    starts[c] = index;

    for (const glyph of cluster.glyphs) {
      const slot = counts[glyph.font]++;
      fonts[index] = glyph.font;
      slots[index] = slot * 2;
      ids[glyph.font][slot] = glyph.id;
      advance[index] = glyph.advance;
      dx[index] = glyph.dx;
      dy[index] = glyph.dy;
      index++;
    }
  });
  starts[paragraphGlyphs.clusters.length] = index;

  return { starts, fonts, slots, advance, dx, dy, ids };
}

export type PackedGlyphs = ReturnType<typeof packGlyphs>;
