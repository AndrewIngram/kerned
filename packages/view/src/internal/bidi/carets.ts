import type { Geometry, Line, Rect } from '../engines.js';
import type { Direction, Position } from '../layout-types.js';

/** Separate logical and visual indexes. The builder is discarded at publication. */
export function createBidiCarets(lines: Line[], lineHeight: number, rtl: boolean) {
  const pending: { index: number; x: number; upstream: boolean; row: number }[] = [];
  const spans: { from: number; to: number; left: number; right: number; row: number }[] = [];
  let row = -1;
  let snapshot: ReturnType<typeof finishCarets> | undefined;

  function current() {
    if (!snapshot) throw new Error('Caret geometry has not been published');

    return snapshot;
  }

  return {
    beginLine() {
      row++;
    },
    append(index: number, x: number, upstream: boolean) {
      pending.push({ index, x, upstream, row });
    },
    span(from: number, to: number, x1: number, x2: number) {
      spans.push({ from, to, left: Math.min(x1, x2), right: Math.max(x1, x2), row });
    },
    finish() {
      snapshot = finishCarets(pending, spans, lines, lineHeight, rtl);
      pending.length = 0;
      spans.length = 0;
    },
    storage: () => current().storage(),
    hit: (x: number, y: number) => current().hit(x, y),
    geometry: (anchor: number, focus: number, upstream: boolean) =>
      current().geometry(anchor, focus, upstream),
    move: (index: number, upstream: boolean, direction: Direction) =>
      current().move(index, upstream, direction),
  };
}

function finishCarets(
  pending: { index: number; x: number; upstream: boolean; row: number }[],
  spans: { from: number; to: number; left: number; right: number; row: number }[],
  lines: Line[],
  lineHeight: number,
  rtl: boolean,
) {
  pending.sort(
    (a, b) =>
      a.row - b.row || a.x - b.x || a.index - b.index || Number(a.upstream) - Number(b.upstream),
  );
  spans.sort((a, b) => a.row - b.row || a.left - b.left);
  const offsets = Uint32Array.from(pending, (stop) => stop.index);
  const xs = Float64Array.from(pending, (stop) => stop.x);
  const rows = Uint32Array.from(pending, (stop) => stop.row);
  const affinities = Uint8Array.from(pending, (stop) => Number(stop.upstream));

  const logical = Uint32Array.from(pending, (_, i) => i).toSorted(
    (a, b) => offsets[a] - offsets[b] || affinities[a] - affinities[b],
  );

  const rowStarts = new Uint32Array(lines.length + 1);
  let cursor = 0;

  for (let row = 0; row < lines.length; row++) {
    rowStarts[row] = cursor;

    while (cursor < rows.length && rows[cursor] === row) cursor++;
  }

  rowStarts[lines.length] = cursor;
  const from = Uint32Array.from(spans, (span) => span.from);
  const to = Uint32Array.from(spans, (span) => span.to);
  const left = Float64Array.from(spans, (span) => span.left);
  const right = Float64Array.from(spans, (span) => span.right);
  const spanRows = Uint32Array.from(spans, (span) => span.row);

  const bytes = [
    offsets,
    xs,
    rows,
    affinities,
    logical,
    rowStarts,
    from,
    to,
    left,
    right,
    spanRows,
  ].reduce((sum, array) => sum + array.byteLength, 0);

  function locate(index: number, upstream: boolean) {
    let lo = 0,
      hi = logical.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;

      if (offsets[logical[mid]] < index) lo = mid + 1;
      else hi = mid;
    }

    const fallback = logical[Math.min(lo, logical.length - 1)];

    for (let i = lo; i < logical.length && offsets[logical[i]] === index; i++)
      if (affinities[logical[i]] === Number(upstream)) return logical[i];

    return fallback;
  }

  function position(ordinal: number): Position {
    return { index: offsets[ordinal], upstream: affinities[ordinal] !== 0 };
  }

  function closest(x: number, row: number) {
    row = Math.max(0, Math.min(lines.length - 1, row));

    const first = rowStarts[row],
      end = rowStarts[row + 1];

    let lo = first,
      hi = end;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;

      if (xs[mid] < x) lo = mid + 1;
      else hi = mid;
    }

    return lo === end ? end - 1 : lo > first && x - xs[lo - 1] < xs[lo] - x ? lo - 1 : lo;
  }

  return {
    storage: () => ({
      caretBufferBytes: bytes,
      caretUsedBytes: bytes,
      caretUnusedBytes: 0,
      caretCapacity: offsets.length,
      caretCount: offsets.length,
      lineCapacity: lines.length,
      lineCount: lines.length,
    }),
    hit: (x: number, y: number) => position(closest(x, Math.floor(y / lineHeight))),
    geometry(anchor: number, focus: number, upstream: boolean): Geometry {
      const ordinal = locate(focus, upstream),
        line = lines[rows[ordinal]];

      const rects: Rect[] = [];
      const caret: Rect = [xs[ordinal], line.top, xs[ordinal] + 1, line.bottom];

      if (anchor === focus) return { caret, rects };

      const low = Math.min(anchor, focus),
        high = Math.max(anchor, focus);

      for (let i = 0; i < from.length; i++) {
        if (from[i] >= high || to[i] <= low) continue;

        const top = lines[spanRows[i]].top,
          bottom = lines[spanRows[i]].bottom;

        const previous = rects.at(-1);

        if (previous && previous[1] === top && left[i] <= previous[2])
          previous[2] = Math.max(previous[2], right[i]);
        else rects.push([left[i], top, right[i], bottom]);
      }

      return { caret, rects };
    },
    move(index: number, upstream: boolean, direction: Direction): Position {
      const ordinal = locate(index, upstream),
        row = rows[ordinal];

      if (direction === 'up' || direction === 'down')
        return position(closest(xs[ordinal], row + (direction === 'up' ? -1 : 1)));

      if (direction === 'home' || direction === 'end')
        return position(direction === 'home' ? rowStarts[row] : rowStarts[row + 1] - 1);
      const step = direction === 'left' ? -1 : 1;
      let next = ordinal + step;

      // A run boundary can expose two model positions at one visual location.
      // Move to the next visible stop; do not require a keypress for every alias.
      while (next >= 0 && next < offsets.length && rows[next] === row && xs[next] === xs[ordinal])
        next += step;

      if (next >= 0 && next < offsets.length && rows[next] === row) return position(next);
      const nextRow = row + (rtl ? -step : step);

      if (nextRow < 0 || nextRow >= lines.length) return position(ordinal);

      return position(step < 0 ? rowStarts[nextRow + 1] - 1 : rowStarts[nextRow]);
    },
  };
}
