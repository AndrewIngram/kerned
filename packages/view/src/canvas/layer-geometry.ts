import type { NodeIdentity } from '@kerned/model';

import type { BlockTextGeometry, InlineBounds } from '../browser/drawing.js';
import type { LaidOut } from '../internal/engines.js';
import type { Placement } from './scene.js';

/** Share pure line fragments without exposing shaping, drawing or resource disposal. */
export function createLayerGeometry() {
  const cache = new WeakMap<LaidOut, BlockTextGeometry>();
  const emptyInline: readonly InlineBounds[] = [];

  const inlines = new WeakMap<Placement<NodeIdentity>['boxes'], readonly InlineBounds[]>();

  function text(layout: LaidOut | null): BlockTextGeometry | null {
    if (!layout) return null;
    let value = cache.get(layout);

    if (!value) {
      value = {
        caret(offset, upstream = false) {
          const rect = layout.geometry(offset, offset, upstream).caret;

          return {
            left: rect[0],
            top: rect[1],
            width: rect[2] - rect[0],
            height: rect[3] - rect[1],
          };
        },
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
  }

  function inlineBounds(boxes: Placement<NodeIdentity>['boxes']) {
    if (!boxes.length) return emptyInline;
    let inline = inlines.get(boxes);

    if (!inline) {
      inline = boxes.map((box) => ({
        id: box.id,
        index: box.index,
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
      }));
      inlines.set(boxes, inline);
    }

    return inline;
  }

  return <N extends NodeIdentity>(placement: Placement<N>) => ({
    node: placement.node,
    y: placement.y,
    height: placement.height,
    text: text(placement.layout),
    inline: inlineBounds(placement.boxes),
  });
}
