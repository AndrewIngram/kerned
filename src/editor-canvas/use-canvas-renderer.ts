import type { CanvasKit, Paint } from 'canvaskit-wasm';
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import type { CanvasPainter, CanvasPaintLayer } from '../editor-react';
import type { LaidOut, Rect } from '../engines';

type CanvasBlock<N> = { node: N; y: number; height: number; layout: LaidOut | null };

export type PaintReport = { at: number; duration: number; submitted: number };

type CanvasFrame<N> = {
  inset: number;
  kit: CanvasKit;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  zoom: number;
  top: number;
  background: readonly [number, number, number];
  blocks: readonly CanvasBlock<N>[];
  selectedRange: (node: N) => { from: number; to: number } | null;
  highlights: readonly { rects: readonly Rect[]; active: boolean }[];
  caret: Rect | undefined;
  caretTop: number;
  focused: boolean;
  onPaint: (report: PaintReport) => void;
};

/** Owns the native surface, painter registrations and one scheduled frame. It has
 * no knowledge of schema names, samples, streaming, search or comments. */
export function useCanvasRenderer<N>(frame: CanvasFrame<N>) {
  const { kit, canvasRef, width, height } = frame;

  const renderer = useRef<{
    surface: NonNullable<ReturnType<CanvasKit['MakeSWCanvasSurface']>>;
    paint: Paint;
  } | null>(null);

  const painters = useRef(new Map<string, { paint: CanvasPainter; layer: CanvasPaintLayer }>());

  const drawRef = useRef(() => {}),
    scheduled = useRef(0);

  const schedule = useMemo(
    () => () => {
      if (scheduled.current) return;
      scheduled.current = requestAnimationFrame(() => {
        scheduled.current = 0;
        drawRef.current();
      });
    },
    [],
  );

  const register = useMemo(
    () => (id: string, paint: CanvasPainter, layer: CanvasPaintLayer) => {
      painters.current.set(id, { paint, layer });
      schedule();

      return () => {
        painters.current.delete(id);
        schedule();
      };
    },
    [schedule],
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const surface = kit.MakeSWCanvasSurface(canvas);

    if (!surface) throw new Error('Canvas unavailable');
    const paint = new kit.Paint();
    paint.setAntiAlias(true);
    renderer.current = { surface, paint };

    return () => {
      renderer.current = null;
      surface.dispose();
      paint.delete();
    };
  }, [kit, width, height]);
  useLayoutEffect(
    () => () => {
      cancelAnimationFrame(scheduled.current);
      scheduled.current = 0;
    },
    [],
  );
  useLayoutEffect(() => {
    drawRef.current = () => {
      const target = renderer.current;

      if (!target) return;

      const { surface, paint } = target,
        { zoom, top } = frame,
        bottom = top + height / zoom;

      const started = performance.now();
      let submitted = 0;

      const canvas = surface.getCanvas(),
        dpr = window.devicePixelRatio || 1;

      canvas.clear(kit.Color(...frame.background));
      canvas.save();
      canvas.scale(dpr * zoom, dpr * zoom);
      canvas.translate(frame.inset, -top);

      for (const painter of painters.current.values())
        if (painter.layer === 'background') painter.paint(canvas, kit, paint);
      paint.setColor(kit.Color(194, 216, 235));

      for (const block of frame.blocks) {
        const range = frame.selectedRange(block.node);

        if (!range || !block.layout) continue;

        for (const r of block.layout.geometry(range.from, range.to, false).rects)
          canvas.drawRect(kit.XYWHRect(r[0], r[1] + block.y, r[2] - r[0], r[3] - r[1]), paint);
      }

      for (const { rects, active } of frame.highlights) {
        paint.setColor(active ? kit.Color(245, 185, 65) : kit.Color(255, 236, 151));

        for (const r of rects)
          canvas.drawRect(kit.XYWHRect(r[0], r[1], r[2] - r[0], r[3] - r[1]), paint);
      }

      for (const block of frame.blocks)
        if (block.layout && block.y + block.height > top - 80 && block.y < bottom + 80) {
          submitted++;

          if (block.layout.drawViewport)
            block.layout.drawViewport(
              canvas,
              0,
              block.y,
              top - block.y - 80,
              bottom - block.y + 80,
            );
          else block.layout.draw(canvas, 0, block.y);
        }

      for (const painter of painters.current.values())
        if (painter.layer === 'content') painter.paint(canvas, kit, paint);
      const caret = frame.caret;

      if (caret && frame.focused) {
        paint.setColor(kit.Color(35, 48, 31));
        canvas.drawRect(
          kit.XYWHRect(caret[0], caret[1] + frame.caretTop, 1, caret[3] - caret[1]),
          paint,
        );
      }

      canvas.restore();
      surface.flush();
      const at = performance.now();
      frame.onPaint({ at, duration: at - started, submitted });
    };

    schedule();

    return () => {
      drawRef.current = () => {};
    };
  });

  return { register, painters };
}
