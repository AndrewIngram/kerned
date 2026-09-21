import type { Canvas, CanvasKit, Paint } from 'canvaskit-wasm';

import type { LaidOut, Rect } from '../engines';

export type CanvasPainter = (canvas: Canvas, kit: CanvasKit, paint: Paint) => void;

export type CanvasPaintLayer = 'background' | 'content';

export type RegisterCanvasPainter = (
  id: string,
  painter: CanvasPainter,
  layer: CanvasPaintLayer,
) => () => void;

type CanvasBlock<N> = { node: N; y: number; height: number; layout: LaidOut | null };

export type PaintReport = { at: number; duration: number; submitted: number };

export type CanvasDiagnostics = { readonly painterCount: number };

export type CanvasFrame<N> = {
  inset: number;
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

type Resources = {
  surface: NonNullable<ReturnType<CanvasKit['MakeSWCanvasSurface']>>;
  paint: Paint;
  width: number;
  height: number;
  retired: boolean;
};

function dispose(resources: Resources) {
  resources.surface.dispose();
  resources.paint.delete();
}

/** One paint owner, independent of framework lifetimes. Attachments may be replaced;
 * destruction is terminal. Neither detach nor a stale registration can affect a successor. */
export function createCanvasRenderer<N>() {
  let attachment: { kit: CanvasKit; canvas: HTMLCanvasElement; resources?: Resources } | undefined;
  let frame: CanvasFrame<N> | undefined;
  let scheduled = 0;
  let destroyed = false;
  let drawing: Resources | undefined;
  const painters = new Map<string, { paint: CanvasPainter; layer: CanvasPaintLayer }>();

  function assertActive() {
    if (destroyed) throw new Error('Canvas renderer is destroyed');
  }

  function retire(resources: Resources | undefined) {
    if (!resources || resources.retired) return;
    resources.retired = true;

    if (drawing !== resources) dispose(resources);
  }

  function cancel() {
    cancelAnimationFrame(scheduled);
    scheduled = 0;
  }

  function draw() {
    const target = attachment;
    const current = frame;

    if (!target || !current || destroyed) return;
    const { kit } = target;
    const resources = target.resources;

    if (!resources) return;
    const { height } = current;
    drawing = resources;

    try {
      paintFrame(current, kit, resources, height);
    } finally {
      drawing = undefined;

      if (resources.retired) dispose(resources);
    }
  }

  function paintFrame(
    current: CanvasFrame<N>,
    kit: CanvasKit,
    resources: Resources,
    height: number,
  ) {
    const { surface, paint } = resources,
      { zoom, top } = current,
      bottom = top + height / zoom;

    const started = performance.now();
    let submitted = 0;

    const canvas = surface.getCanvas(),
      dpr = window.devicePixelRatio || 1;

    canvas.clear(kit.Color(...current.background));
    canvas.save();

    try {
      canvas.scale(dpr * zoom, dpr * zoom);
      canvas.translate(current.inset, -top);

      for (const painter of painters.values())
        if (painter.layer === 'background') {
          painter.paint(canvas, kit, paint);

          if (resources.retired) return;
        }

      paint.setColor(kit.Color(194, 216, 235));

      for (const block of current.blocks) {
        const range = current.selectedRange(block.node);

        if (!range || !block.layout) continue;

        for (const r of block.layout.geometry(range.from, range.to, false).rects)
          canvas.drawRect(kit.XYWHRect(r[0], r[1] + block.y, r[2] - r[0], r[3] - r[1]), paint);
      }

      for (const { rects, active } of current.highlights) {
        paint.setColor(active ? kit.Color(245, 185, 65) : kit.Color(255, 236, 151));

        for (const r of rects)
          canvas.drawRect(kit.XYWHRect(r[0], r[1], r[2] - r[0], r[3] - r[1]), paint);
      }

      for (const block of current.blocks)
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

      for (const painter of painters.values())
        if (painter.layer === 'content') {
          painter.paint(canvas, kit, paint);

          if (resources.retired) return;
        }

      const caret = current.caret;

      if (caret && current.focused) {
        paint.setColor(kit.Color(35, 48, 31));
        canvas.drawRect(
          kit.XYWHRect(caret[0], caret[1] + current.caretTop, 1, caret[3] - caret[1]),
          paint,
        );
      }
    } finally {
      canvas.restore();
    }

    if (resources.retired) return;
    surface.flush();
    const at = performance.now();
    current.onPaint({ at, duration: at - started, submitted });
  }

  function schedule() {
    if (!attachment || !frame || scheduled || destroyed) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      draw();
    });
  }

  function resize() {
    if (!attachment || !frame) return;
    const { kit, canvas, resources } = attachment;
    const dpr = window.devicePixelRatio || 1;

    const width = Math.round(frame.width * dpr),
      height = Math.round(frame.height * dpr);

    if (resources?.width === width && resources.height === height) return;
    attachment.resources = undefined;
    retire(resources);
    canvas.width = width;
    canvas.height = height;
    const surface = kit.MakeSWCanvasSurface(canvas);

    if (!surface) throw new Error('Canvas unavailable');

    try {
      const paint = new kit.Paint();

      try {
        paint.setAntiAlias(true);
      } catch (error) {
        paint.delete();
        throw error;
      }

      attachment.resources = { surface, paint, width, height, retired: false };
    } catch (error) {
      surface.dispose();
      throw error;
    }
  }

  return {
    attach(kit: CanvasKit, canvas: HTMLCanvasElement) {
      assertActive();

      if (attachment) throw new Error('Canvas renderer already has an attachment');
      const target = { kit, canvas };
      attachment = target;

      try {
        resize();
        schedule();
      } catch (error) {
        attachment = undefined;
        throw error;
      }

      return () => {
        if (attachment !== target) return;
        cancel();
        retire(attachment.resources);
        attachment = undefined;
        frame = undefined;
      };
    },
    update(next: CanvasFrame<N>) {
      assertActive();
      frame = next;
      resize();
      schedule();
    },
    register: ((id, paint, layer) => {
      assertActive();
      const registration = { paint, layer };
      painters.set(id, registration);
      schedule();

      return () => {
        if (painters.get(id) !== registration) return;
        painters.delete(id);
        schedule();
      };
    }) satisfies RegisterCanvasPainter,
    diagnostics: {
      get painterCount() {
        return painters.size;
      },
    } satisfies CanvasDiagnostics,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancel();
      retire(attachment?.resources);
      attachment = undefined;
      frame = undefined;
      painters.clear();
    },
  };
}
