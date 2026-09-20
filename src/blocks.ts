import type { CanvasKit, Image } from "canvaskit-wasm";
import type { Engine, LaidOut, Rect } from "./engines";
import type { Atom } from "./model";

// Decoded media belongs to the renderer, never to undo snapshots.
const images = new Map<string, Image>();
export function retainImages(sources: Set<string>) {
  for (const [source, image] of images)
    if (!sources.has(source)) {
      image.delete();
      images.delete(source);
    }
}
export function registerImage(
  kit: CanvasKit,
  source: string,
  bytes: Uint8Array,
) {
  const image = kit.MakeImageFromEncoded(bytes);
  if (!image)
    throw new Error(
      "This image could not be decoded. Try a PNG, JPEG, or WebP image.",
    );
  images.set(source, image);
  return { width: image.width(), height: image.height() };
}
export function layoutAtom(
  kit: CanvasKit,
  engine: Engine,
  atom: Atom,
  width: number,
  size: number,
): LaidOut {
  const title = engine.layout({
    id: atom.id,
    text: atom.title + (atom.kind === "embed" ? `\n${atom.url}` : ""),
    spans: [],
    width: Math.max(20, width - 32),
    size: Math.min(size, 17),
  });
  const mediaHeight =
    atom.kind === "image"
      ? Math.min((width * atom.height) / atom.width, 300)
      : 0;
  const height = mediaHeight + title.height + 32;
  return {
    height,
    lines: [],
    coreMs: title.coreMs,
    adapterMs: title.adapterMs,
    missing: title.missing,
    draw(canvas, x, y) {
      const paint = new kit.Paint();
      paint.setAntiAlias(true);
      paint.setColor(kit.Color(242, 245, 236));
      canvas.drawRect(kit.XYWHRect(x, y, width, height), paint);
      if (atom.kind === "image") {
        const image = images.get(atom.source);
        if (image) {
          const drawWidth = (mediaHeight * atom.width) / atom.height;
          canvas.drawImageRect(
            image,
            kit.XYWHRect(0, 0, atom.width, atom.height),
            kit.XYWHRect(
              x + (width - drawWidth) / 2,
              y,
              drawWidth,
              mediaHeight,
            ),
            paint,
          );
        }
      }
      title.draw(canvas, x + 16, y + mediaHeight + 16);
      paint.delete();
    },
    hit(x) {
      return { index: x < width / 2 ? 0 : 1, upstream: false };
    },
    geometry(anchor, focus) {
      const x = focus ? width : 0;
      const caret: Rect = [x, 0, x + 2, height];
      return { caret, rects: anchor === focus ? [] : [[0, 0, width, height]] };
    },
    move(index, upstream, direction) {
      return {
        index:
          direction === "left" || direction === "up" || direction === "home"
            ? 0
            : 1,
        upstream: index === 0 && upstream,
      };
    },
    dispose() {
      title.dispose();
    },
  };
}
