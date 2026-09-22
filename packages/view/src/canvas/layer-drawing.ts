import type { Color } from 'canvaskit-wasm';

import type { Drawing, LayerDrawing, PreparedText } from '../browser/drawing.js';
import type { LaidOut } from '../internal/engines.js';
import type { RegisterCanvasPainter } from './canvas-renderer.js';
import type { TextLabels } from './text-labels.js';

type Label = {
  input: Parameters<TextLabels>[0];
  layout: LaidOut;
};

/** Keep graphics objects inside the renderer while extensions paint in document coordinates. */
export function createLayerDrawing(
  register: RegisterCanvasPainter,
  inset: () => number,
  initialLabels: TextLabels,
): LayerDrawing & { replaceLabels: (next: TextLabels) => void } {
  let labels = initialLabels;
  const colors = new Map<string, Color>();
  let prepared = new WeakMap<LaidOut, PreparedText>();
  const layouts = new WeakMap<PreparedText, Label>();
  const retained = new Set<WeakRef<Label>>();

  function liveLabels() {
    const live: Label[] = [];

    for (const reference of retained) {
      const label = reference.deref();

      if (label) live.push(label);
      else retained.delete(reference);
    }

    return live;
  }

  return {
    replaceLabels(next) {
      labels = next;
      prepared = new WeakMap();

      // Refresh retained extension handles before painting, without retaining dead widgets.
      for (const label of liveLabels()) label.layout = labels(label.input);
    },
    prepareText(input) {
      const layout = labels(input);
      let label = prepared.get(layout);

      if (!label) {
        const value = { input: { ...input }, layout };
        label = Object.freeze({
          width: input.width,
          get height() {
            return value.layout.height;
          },
        });
        prepared.set(layout, label);
        layouts.set(label, value);
        liveLabels();
        retained.add(new WeakRef(value));
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
              const value = layouts.get(label);

              if (!value) throw new Error('Text must be prepared by this view');
              value.layout.draw(canvas, left, top);
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
