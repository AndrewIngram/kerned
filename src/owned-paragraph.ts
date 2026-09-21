import type { Geometry, Line, Rect } from './engines';
import type { Direction, Position } from './layout-types';
import { createPackedCarets } from './owned-carets';
import type { PackedGlyphs } from './owned-packed';
import type { PackedShaping } from './owned-shaped';

export type Glyph = {
  id: number;
  start: number;
  advance: number;
  dx: number;
  dy: number;
  font: number;
};

export type Cluster = {
  start: number;
  end: number;
  width: number;
  glyphs: Glyph[];
  stops: number[];
};

export type ParagraphGlyphs = { clusters: Cluster[]; breaks: Set<number> };

type Stop = Position & { x: number; line: number };

// All coordinates and character offsets are paragraph-local. Never modify a
// published paragraph: document snapshots may share it across different origins.
export function composeParagraph(
  paragraphGlyphs: ParagraphGlyphs | PackedShaping,
  textLength: number,
  width: number,
  lineHeight: number,
  baseline: number,
  packed?: PackedGlyphs,
  caretStorage: 'objects' | 'packed' = 'objects',
) {
  const numeric = 'clusterStarts' in paragraphGlyphs ? paragraphGlyphs : undefined;
  const clusters = 'clusters' in paragraphGlyphs ? paragraphGlyphs.clusters : [];
  const clusterCount = numeric ? numeric.widths.length : clusters.length;

  const stopCount = numeric
    ? numeric.stops.length
    : clusters.reduce((n, c) => n + c.stops.length, 0);

  const lines: Line[] = [];

  const numericCarets =
    caretStorage === 'packed'
      ? createPackedCarets(
          stopCount + Math.max(1, clusterCount),
          Math.max(1, clusterCount),
          lines,
          lineHeight,
        )
      : undefined;

  const stops: Stop[] = [];
  const rows: Stop[][] = [];
  const packedPositions = packed?.ids.map((ids) => new Float32Array(ids.length * 2));

  const fontCount = packed
    ? 0
    : clusters.reduce(
        (max, cluster) => cluster.glyphs.reduce((n, glyph) => Math.max(n, glyph.font + 1), max),
        0,
      );

  const glyphs: number[][] = Array.from({ length: fontCount }, () => []);
  const positions: number[][] = Array.from({ length: fontCount }, () => []);
  const ranges: { font: number; from: number; to: number }[] = [];

  function appendRun(font: number, slot: number) {
    const previous = ranges.at(-1);

    if (previous?.font === font) previous.to = slot + 1;
    else ranges.push({ font, from: slot, to: slot + 1 });
  }

  let first = 0;

  do {
    let end = first,
      advance = 0,
      lastBreak = first;

    while (end < clusterCount) {
      const clusterWidth = numeric ? numeric.widths[end] : clusters[end].width;

      // Always fit at least one cluster, including in a temporarily zero-width slot.
      // Its glyphs may overflow, just as a single glyph wider than a narrow line does.
      if (end > first && advance + clusterWidth > width) break;
      advance += clusterWidth;

      const canBreak = numeric
        ? numeric.breaks[end]
        : paragraphGlyphs.breaks instanceof Set && paragraphGlyphs.breaks.has(clusters[end].end);

      end++;

      if (canBreak) lastBreak = end;
    }

    if (end < clusterCount && lastBreak > first) end = lastBreak;
    const start = (numeric ? numeric.clusterStarts[first] : clusters[first]?.start) ?? 0;
    const finish = (numeric ? numeric.clusterEnds[end - 1] : clusters[end - 1]?.end) ?? 0;

    const line = lines.length,
      top = line * lineHeight;

    const row: Stop[] = [];
    numericCarets?.beginLine();

    function append(index: number, x: number, upstream: boolean) {
      if (numericCarets) numericCarets.append(index, x, upstream);
      else {
        const stop = { index, x, line, upstream };
        row.push(stop);
        stops.push(stop);
      }
    }

    append(start, 0, false);
    let x = 0;

    for (let i = first; i < end; i++) {
      const clusterWidth = numeric ? numeric.widths[i] : clusters[i].width;
      let pen = x;

      if (packed && packedPositions) {
        for (let g = packed.starts[i]; g < packed.starts[i + 1]; g++) {
          const output = packedPositions[packed.fonts[g]],
            slot = packed.slots[g];

          output[slot] = pen + packed.dx[g];
          output[slot + 1] = top + baseline - packed.dy[g];
          appendRun(packed.fonts[g], slot / 2);
          pen += packed.advance[g];
        }
      } else {
        for (const glyph of clusters[i].glyphs) {
          appendRun(glyph.font, glyphs[glyph.font].length);
          glyphs[glyph.font].push(glyph.id);
          positions[glyph.font].push(pen + glyph.dx, top + baseline - glyph.dy);
          pen += glyph.advance;
        }
      }

      if (numeric) {
        const from = numeric.stopStarts[i],
          to = numeric.stopStarts[i + 1];

        for (let s = from; s < to; s++) {
          const index = numeric.stops[s];
          append(
            index,
            x + (clusterWidth * (s - from + 1)) / (to - from),
            index === finish && finish < textLength,
          );
        }
      } else
        clusters[i].stops.forEach((index, n) =>
          append(
            index,
            x + (clusterWidth * (n + 1)) / clusters[i].stops.length,
            index === finish && finish < textLength,
          ),
        );
      x += clusterWidth;
    }

    lines.push({
      start,
      end: finish,
      top,
      bottom: top + lineHeight,
      baseline: top + baseline,
      width: x,
    });

    if (!numericCarets) rows.push(row);
    first = end;
  } while (first < clusterCount);

  // Preserve visual text order when glyph ink overlaps across faces. Native
  // registration order must not affect compositing. Runs borrow numeric buffers.
  const ids = packed?.ids ?? glyphs.map((values) => new Uint16Array(values));
  const coordinates = packedPositions ?? positions.map((values) => new Float32Array(values));

  const runs = ranges.map(({ font, from, to }) => ({
    font,
    glyphs: ids[font].subarray(from, to),
    positions: coordinates[font].subarray(from * 2, to * 2),
  }));

  return finishParagraph(
    width,
    textLength,
    lineHeight,
    baseline,
    lines,
    runs,
    numericCarets,
    stops,
    rows,
  );
}

// Keep snapshot closures outside the composition scope. Otherwise captured
// locals can keep the entire shaping graph alive after its cache is released.
function finishParagraph(
  width: number,
  textLength: number,
  lineHeight: number,
  baseline: number,
  lines: Line[],
  runs: { font: number; glyphs: Uint16Array; positions: Float32Array }[],
  numericCarets: ReturnType<typeof createPackedCarets> | undefined,
  stops: Stop[],
  rows: Stop[][],
) {
  if (numericCarets) {
    numericCarets.finish();

    return {
      inkTop: 0,
      inkBottom: lines.length * lineHeight,
      width,
      textLength,
      lineHeight,
      baseline,
      height: lines.length * lineHeight,
      lines,
      runs,
      storage: () => ({
        ...numericCarets.storage(),
        glyphBufferBytes: runs.reduce(
          (n, r) => n + r.glyphs.byteLength + r.positions.byteLength,
          0,
        ),
      }),
      hit: numericCarets.hit,
      geometry: numericCarets.geometry,
      move: numericCarets.move,
    };
  }

  const byOffset = new Map<number, { downstream: Stop; upstream: Stop }>();

  for (const stop of stops) {
    const pair = byOffset.get(stop.index);

    if (!pair) byOffset.set(stop.index, { downstream: stop, upstream: stop });
    else if (stop.upstream) pair.upstream = stop;
    else pair.downstream = stop;
  }

  function locate(index: number, upstream: boolean) {
    const pair = byOffset.get(index);

    return pair ? (upstream ? pair.upstream : pair.downstream) : stops[stops.length - 1];
  }

  function closest(x: number, line: number) {
    return rows[Math.max(0, Math.min(rows.length - 1, line))].reduce((a, b) =>
      Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a,
    );
  }

  return {
    inkTop: 0,
    inkBottom: lines.length * lineHeight,
    width,
    textLength,
    lineHeight,
    baseline,
    height: lines.length * lineHeight,
    lines,
    runs,
    storage: () => ({
      caretBufferBytes: 0,
      caretUsedBytes: 0,
      caretUnusedBytes: 0,
      caretCapacity: stops.length,
      caretCount: stops.length,
      lineCapacity: rows.length,
      lineCount: rows.length,
      glyphBufferBytes: runs.reduce((n, r) => n + r.glyphs.byteLength + r.positions.byteLength, 0),
    }),
    hit(x: number, y: number): Position {
      return position(closest(x, Math.floor(y / lineHeight)));
    },
    geometry(anchor: number, focus: number, upstream: boolean): Geometry {
      const stop = locate(focus, upstream),
        line = lines[stop.line];

      const rects: Rect[] = [];

      if (anchor !== focus) {
        const low = Math.min(anchor, focus),
          high = Math.max(anchor, focus);

        for (let n = 0; n < lines.length; n++) {
          if (lines[n].end < low || lines[n].start > high) continue;
          const row = rows[n].filter((p) => p.index >= low && p.index <= high);

          if (row.length > 1)
            rects.push([row[0].x, lines[n].top, row[row.length - 1].x, lines[n].bottom]);
        }
      }

      return { caret: [stop.x, line.top, stop.x + 1, line.bottom], rects };
    },
    move(index: number, upstream: boolean, direction: Direction): Position {
      const stop = locate(index, upstream);

      if (direction === 'up' || direction === 'down')
        return position(closest(stop.x, stop.line + (direction === 'up' ? -1 : 1)));

      if (direction === 'home' || direction === 'end')
        return position(closest(direction === 'home' ? 0 : lines[stop.line].width, stop.line));
      const ordinal = stops.indexOf(stop);

      return position(
        stops[Math.max(0, Math.min(stops.length - 1, ordinal + (direction === 'left' ? -1 : 1)))],
      );
    },
  };
}

export type ComposedParagraph = ReturnType<typeof composeParagraph>;

function position(stop: Stop): Position {
  return { index: stop.index, upstream: stop.upstream };
}
