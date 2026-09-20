import CanvasKitInit from "canvaskit-wasm";
import type {
  CanvasKit,
  Canvas,
  Font,
  Paragraph,
  Typeface,
} from "canvaskit-wasm";
import { z } from "zod";
import { boundaries, type Direction, type Position, type Span } from "./model";

const rectSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type Rect = z.infer<typeof rectSchema>;
const positionSchema = z.object({ index: z.number(), upstream: z.boolean() });
const lineSchema = z.object({
  start: z.number(),
  end: z.number(),
  top: z.number(),
  bottom: z.number(),
  baseline: z.number(),
  width: z.number(),
});
const runSchema = z.object({
  font: z.number(),
  size: z.number(),
  glyphs: z.array(z.number()),
  positions: z.array(z.number()),
});
const layoutSchema = z.object({
  height: z.number(),
  lines: z.array(lineSchema),
  runs: z.array(runSchema),
  coreMs: z.number(),
  missing: z.number(),
});
const geometrySchema = z.object({
  caret: rectSchema,
  rects: z.array(rectSchema),
});
export type Line = z.infer<typeof lineSchema>;
export type Geometry = z.infer<typeof geometrySchema>;
type Input = {
  lineHeight?: number;
  baselineGrid?: number;
  id: number;
  text: string;
  spans: Span[];
  width: number;
  size: number;
};
export interface LaidOut {
  height: number;
  lines: Line[];
  coreMs: number;
  adapterMs: number;
  missing: number;
  draw(canvas: Canvas, x: number, y: number): void;
  // Document-space vertical interval, before draw translation or canvas scaling.
  drawViewport?(canvas: Canvas, x: number, y: number, top: number, bottom: number): { paragraphs: number; runs: number };
  hit(x: number, y: number): Position;
  geometry(anchor: number, focus: number, upstream: boolean): Geometry;
  move(index: number, upstream: boolean, direction: Direction): Position;
  dispose(): void;
}
export interface Engine {
  name: string;
  layout(input: Input): LaidOut;
  clear(): void;
}
export const fontFiles = [
  "NotoSans-Regular.ttf",
  "NotoSans-Bold.ttf",
  "NotoSans-Italic.ttf",
  "NotoSans-BoldItalic.ttf",
  "NotoSansArabic-Regular.ttf",
  "NotoSansHebrew-Regular.ttf",
  "NotoSansDevanagari-Regular.ttf",
  "NotoSansCJKjp-Regular.otf",
  "NotoColorEmoji.ttf",
];
const families = [
  "Noto Sans",
  "Noto Sans Arabic",
  "Noto Sans Hebrew",
  "Noto Sans Devanagari",
  "Noto Sans CJK JP",
  "Noto Color Emoji",
];

async function binary(path: string) {
  const response = await fetch(path);
  if (!response.ok)
    throw new Error(`${path}: HTTP ${response.status}. Run npm run setup.`);
  return response.arrayBuffer();
}

export async function initialize() {
  const started = performance.now();
  const [kit, fontData, wasm] = await Promise.all([
    CanvasKitInit({ locateFile: () => "/engines/canvaskit.wasm" }),
    Promise.all(fontFiles.map((f) => binary(`/fonts/${f}`))),
    binary("/engines/parley.wasm"),
  ]);
  const bridge = await createBridge(wasm);
  fontData.forEach((buffer, index) => {
    if (bridge.font(new Uint8Array(buffer)) !== index)
      throw new Error(`Parley could not register ${fontFiles[index]}`);
  });
  const manager = kit.FontMgr.FromData(...fontData);
  if (!manager) throw new Error("Skia could not load fonts");
  const faces: Typeface[] = fontData.map((data, index) => {
    const face = kit.Typeface.MakeFreeTypeFaceFromData(data);
    if (!face) throw new Error(`Skia could not load ${fontFiles[index]}`);
    return face;
  });
  const fonts = new Map<string, Font>();
  const paint = new kit.Paint();
  paint.setColor(kit.Color(37, 42, 35));
  paint.setAntiAlias(true);
  function font(index: number, size: number) {
    const key = `${index}:${size}`;
    let result = fonts.get(key);
    if (!result) {
      result = new kit.Font(faces[index], size);
      result.setSubpixel(true);
      fonts.set(key, result);
    }
    return result;
  }
  const canvasKit: Engine = {
    name: "CanvasKit",
    clear() {},
    layout(input) {
      const start = performance.now();
      const builder = kit.ParagraphBuilder.Make(
        new kit.ParagraphStyle({
          textStyle: {
            fontFamilies: families,
            fontSize: input.size,
            color: kit.Color(37, 42, 35),
            heightMultiplier: 1.6,
            halfLeading: true,
          },
          textDirection: kit.TextDirection.LTR,
        }),
        manager,
      );
      const cuts = [
        ...new Set([
          0,
          input.text.length,
          ...input.spans.flatMap((s) => [s.start, s.end]),
        ]),
      ].sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        const from = cuts[i],
          to = cuts[i + 1];
        const styles = input.spans.filter(
          (s) => s.start <= from && s.end >= to,
        );
        builder.pushStyle(
          new kit.TextStyle({
            fontFamilies: families,
            fontSize: input.size,
            color: kit.Color(37, 42, 35),
            heightMultiplier: 1.6,
            halfLeading: true,
            fontStyle: {
              weight: styles.some((s) => s.bold)
                ? kit.FontWeight.Bold
                : kit.FontWeight.Normal,
              slant: styles.some((s) => s.italic)
                ? kit.FontSlant.Italic
                : kit.FontSlant.Upright,
            },
          }),
        );
        builder.addText(input.text.slice(from, to));
        builder.pop();
      }
      const paragraph = builder.build();
      builder.delete();
      paragraph.layout(input.width);
      const coreMs = performance.now() - start;
      const lines = paragraph
        .getLineMetrics()
        .map((l) => ({
          start: l.startIndex,
          end: l.endIncludingNewline,
          top: l.baseline - l.ascent,
          bottom: l.baseline + l.descent,
          baseline: l.baseline,
          width: l.width,
        }));
      const geometry = ckGeometry(kit, paragraph, input.text, input.size);
      return {
        height: Math.max(paragraph.getHeight(), input.size * 1.6),
        lines,
        coreMs,
        adapterMs: performance.now() - start,
        missing: paragraph.unresolvedCodepoints().length,
        draw: (canvas, x, y) => canvas.drawParagraph(paragraph, x, y),
        hit: (x, y) => {
          const p = paragraph.getGlyphPositionAtCoordinate(x, y);
          const stops = boundaries(input.text);
          const index = stops.reduce(
            (best, i) =>
              Math.abs(i - p.pos) < Math.abs(best - p.pos) ? i : best,
            0,
          );
          return { index, upstream: p.affinity === kit.Affinity.Upstream };
        },
        geometry: geometry.get,
        move: geometry.move,
        dispose: () => paragraph.delete(),
      };
    },
  };
  const parley: Engine = {
    name: "Parley",
    clear() {
      bridge.call({ op: "clear" });
    },
    layout(input) {
      const start = performance.now();
      const result = layoutSchema.parse(
        bridge.call({ op: "layout", ...input }),
      );
      const adapterMs = performance.now() - start;
      const runs = result.runs.map((r) => ({
        ...r,
        glyphs: new Uint16Array(r.glyphs),
        positions: new Float32Array(r.positions),
        font: font(r.font, r.size),
      }));
      return {
        ...result,
        height: Math.max(result.height, input.size * 1.6),
        adapterMs,
        draw: (canvas, x, y) => {
          for (const run of runs)
            canvas.drawGlyphs(run.glyphs, run.positions, x, y, run.font, paint);
        },
        hit: (x, y) =>
          positionSchema.parse(bridge.call({ op: "hit", id: input.id, x, y })),
        geometry: (anchor, focus, upstream) =>
          geometrySchema.parse(
            bridge.call({
              op: "geometry",
              id: input.id,
              anchor,
              focus,
              upstream,
            }),
          ),
        move: (index, upstream, direction) =>
          positionSchema.parse(
            bridge.call({
              op: "move",
              id: input.id,
              index,
              upstream,
              direction,
            }),
          ),
        dispose() {},
      };
    },
  };
  return {
    kit,
    engines: [canvasKit, parley],
    loadMs: performance.now() - started,
    fontBytes: fontData.reduce((n, b) => n + b.byteLength, 0),
    parleyBytes: wasm.byteLength,
  };
}

function ckGeometry(kit: CanvasKit, p: Paragraph, text: string, size: number) {
  const stops = boundaries(text);
  function caret(index: number, upstream: boolean): Rect {
    if (!text.length) return [0, 0, 1.5, size * 1.6];
    if (index === 0) upstream = false;
    const previous = stops.filter((i) => i < index).at(-1) ?? 0;
    const info = p.getGlyphInfoAt(
      upstream || index === text.length ? previous : index,
    );
    if (!info) return [0, 0, 1.5, size * 1.6];
    const [l, t, r, b] = info.graphemeLayoutBounds;
    const end = upstream || index === text.length;
    const x = end !== (info.dir === kit.TextDirection.RTL) ? r : l;
    return [x, t, x + 1.5, b];
  }
  let visual: { index: number; upstream: boolean; rect: Rect }[] | null = null;
  return {
    get(anchor: number, focus: number, upstream: boolean): Geometry {
      return {
        caret: caret(focus, upstream),
        rects:
          anchor === focus
            ? []
            : p
                .getRectsForRange(
                  Math.min(anchor, focus),
                  Math.max(anchor, focus),
                  kit.RectHeightStyle.Max,
                  kit.RectWidthStyle.Tight,
                )
                .map(({ rect: r }) => [r[0], r[1], r[2], r[3]]),
      };
    },
    move(index: number, upstream: boolean, direction: Direction): Position {
      if (!visual) {
        visual = stops
          .flatMap((index) =>
            [false, true].map((upstream) => ({
              index,
              upstream,
              rect: caret(index, upstream),
            })),
          )
          .sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
        visual = visual.filter(
          (s, i, a) =>
            !i ||
            Math.abs(s.rect[0] - a[i - 1].rect[0]) > 0.1 ||
            Math.abs(s.rect[1] - a[i - 1].rect[1]) > 0.1,
        );
      }
      const current = caret(index, upstream);
      const sameLine = visual.filter(
        (s) => Math.abs(s.rect[1] - current[1]) < 0.5,
      );
      if (direction === "home") return sameLine[0] ?? { index, upstream };
      if (direction === "end") return sameLine.at(-1) ?? { index, upstream };
      if (direction === "up" || direction === "down") {
        const lineYs = [...new Set(visual.map((s) => s.rect[1]))].sort(
          (a, b) => a - b,
        );
        const y =
          direction === "down"
            ? lineYs.find((y) => y > current[1] + 0.5)
            : lineYs.filter((y) => y < current[1] - 0.5).at(-1);
        if (y === undefined) return { index, upstream };
        const line = visual.filter((s) => s.rect[1] === y);
        return line.reduce(
          (best, s) =>
            Math.abs(s.rect[0] - current[0]) <
            Math.abs(best.rect[0] - current[0])
              ? s
              : best,
          line[0],
        );
      }
      const at = visual.findIndex(
        (s) =>
          Math.abs(s.rect[0] - current[0]) < 0.1 &&
          Math.abs(s.rect[1] - current[1]) < 0.1,
      );
      return (
        visual[at + (direction === "right" ? 1 : -1)] ?? { index, upstream }
      );
    },
  };
}

async function createBridge(bytes: ArrayBuffer) {
  let wasmMemory: WebAssembly.Memory | null = null;
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      now: () => performance.now(),
      log_error: (ptr: number, len: number) => {
        if (wasmMemory)
          throw new Error(
            new TextDecoder().decode(
              new Uint8Array(wasmMemory.buffer, ptr, len),
            ),
          );
      },
    },
  });
  const { memory, allocate, register_font, request, response_len } =
    instance.exports;
  if (
    !(memory instanceof WebAssembly.Memory) ||
    typeof allocate !== "function" ||
    typeof register_font !== "function" ||
    typeof request !== "function" ||
    typeof response_len !== "function"
  )
    throw new Error("Invalid Parley WebAssembly exports");
  wasmMemory = memory;
  if (typeof instance.exports.install_panic_hook === "function")
    instance.exports.install_panic_hook();
  const encode = new TextEncoder(),
    decode = new TextDecoder();
  const input = (bytes: Uint8Array) => {
    const ptr = allocate(bytes.length);
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  };
  return {
    font(bytes: Uint8Array): number {
      return register_font(input(bytes), bytes.length);
    },
    call(value: object): unknown {
      const bytes = encode.encode(JSON.stringify(value));
      const ptr = request(input(bytes), bytes.length);
      const result: unknown = JSON.parse(
        decode.decode(new Uint8Array(memory.buffer, ptr, response_len())),
      );
      if (typeof result === "object" && result && "error" in result)
        throw new Error(String(result.error));
      return result;
    },
  };
}
