import type { Color } from 'canvaskit-wasm';

import type { Drawing, RegisterDrawing } from '../editor-browser/drawing';
import type { RegisterCanvasPainter } from './canvas-renderer';

/** Keep graphics objects inside the renderer while extensions paint in document coordinates. */
export function createLayerDrawing(
  register: RegisterCanvasPainter,
  inset: () => number,
): RegisterDrawing {
  const colors = new Map<string, Color>();

  return (key, layer, painter) =>
    register(
      key,
      (canvas, kit, paint) => {
        let active = true;

        const drawing: Drawing = {
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
    );
}
