import type { Color } from 'canvaskit-wasm';

import type { Drawing, LayerDrawing, PreparedText } from '../editor-browser/drawing';
import type { LaidOut } from '../engines';
import type { RegisterCanvasPainter } from './canvas-renderer';
import type { TextLabels } from './text-labels';

/** Keep graphics objects inside the renderer while extensions paint in document coordinates. */
export function createLayerDrawing(
  register: RegisterCanvasPainter,
  inset: () => number,
  labels: TextLabels,
): LayerDrawing {
  const colors = new Map<string, Color>();
  const prepared = new WeakMap<LaidOut, PreparedText>();
  const layouts = new WeakMap<PreparedText, LaidOut>();

  return {
    prepareText(input) {
      const layout = labels(input);
      let label = prepared.get(layout);

      if (!label) {
        label = Object.freeze({ width: input.width, height: layout.height });
        prepared.set(layout, label);
        layouts.set(label, layout);
      }

      return label;
    },
    register: (key, layer, painter) =>
      register(
        key,
        (canvas, kit, paint) => {
          let active = true;

          const drawing: Drawing = {
            text(label, left, top) {
              if (!active) throw new Error('Drawing is only available during its paint callback');
              const layout = layouts.get(label);

              if (!layout) throw new Error('Text must be prepared by this view');
              layout.draw(canvas, left, top);
            },
            rect(bounds, color, radius = 0) {
              if (!active) throw new Error('Drawing is only available during its paint callback');
              let value = colors.get(color);

              if (!value) {
                value = kit.parseColorString(color);
                colors.set(color, value);
                const oldest = colors.keys().next();

                if (colors.size > 128 && !oldest.done) colors.delete(oldest.value);
              }

              paint.setColor(value);
              const rect = kit.XYWHRect(bounds.left, bounds.top, bounds.width, bounds.height);

              if (radius > 0) canvas.drawRRect(kit.RRectXY(rect, radius, radius), paint);
              else canvas.drawRect(rect, paint);
            },
          };

          canvas.save();

          try {
            canvas.translate(-inset(), 0);
            painter(drawing);
          } finally {
            active = false;
            canvas.restore();
          }
        },
        layer,
      ),
  };
}
