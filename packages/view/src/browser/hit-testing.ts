import type { TextPoint } from '@kerned/model';

export type TextHit = { point: TextPoint; upstream: boolean };

export type TextHitRegion = {
  id: number;
  top: number;
  lines: readonly { top: number; bottom: number }[];
  hit: (x: number, y: number) => { index: number; upstream: boolean };
};

/** Coordinates and line boxes are supplied by the renderer, in document units.
 * Vertical distance chooses the line; that line's hit test chooses the character.
 * Above/below the document and horizontal gutters therefore use the same rule.
 */
export function hitTestTextLines(
  regions: Iterable<TextHitRegion>,
  x: number,
  y: number,
): TextHit | null {
  let nearest: TextHitRegion | undefined,
    lineY = 0,
    distance = Infinity;

  for (const region of regions)
    for (const line of region.lines) {
      const top = region.top + line.top,
        bottom = region.top + line.bottom;

      const d = Math.max(top - y, 0, y - bottom);

      if (d < distance) {
        nearest = region;
        lineY = (line.top + line.bottom) / 2;
        distance = d;
      }
    }

  if (!nearest) return null;
  const hit = nearest.hit(x, lineY);

  return { point: { id: nearest.id, offset: hit.index }, upstream: hit.upstream };
}
