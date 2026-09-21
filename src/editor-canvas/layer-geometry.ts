import type { BlockTextGeometry } from '../editor-browser/drawing';
import type { LaidOut } from '../engines';

/** Share pure line fragments without exposing shaping, drawing or resource disposal. */
export function createLayerGeometry() {
  const cache = new WeakMap<LaidOut, BlockTextGeometry>();

  return (layout: LaidOut | null): BlockTextGeometry | null => {
    if (!layout) return null;
    let value = cache.get(layout);

    if (!value) {
      value = {
        fragments(from, to) {
          return layout.geometry(from, to, false).rects.map((rect) => {
            let low = 0;
            let high = layout.lines.length;

            while (low < high) {
              const middle = (low + high) >>> 1;

              if (layout.lines[middle].bottom <= rect[1]) low = middle + 1;
              else high = middle;
            }

            return {
              left: rect[0],
              top: rect[1],
              width: rect[2] - rect[0],
              height: rect[3] - rect[1],
              baseline: layout.lines[low]?.baseline ?? rect[3],
            };
          });
        },
      };
      cache.set(layout, value);
    }

    return value;
  };
}
