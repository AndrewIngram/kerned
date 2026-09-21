import { boundaries } from './model';

// Views into the existing shaping result. A caller must consume them before
// another native call, or copy words first when assembling multiple style runs.
export type ShapingRun = { words: Uint32Array; floats: Float32Array; font: number; offset: number; scale: number };

export function decodeShaping(text: string, runs: ShapingRun[], lineBreaks: Uint32Array) {
  const counts = new Uint32Array(Math.max(4,...runs.map(run=>run.font+1)));
  let count = 0, glyphCount = 0, previous = -1;

  for (const run of runs) {
    glyphCount += run.words[0];
    counts[run.font] += run.words[0];

    for (let i = 0; i < run.words[0]; i++) {
      const p = 3 + i * 5, start = run.words[p + 1] + run.offset;

      if (start !== previous) { count++; previous = start; }
    }
  }

  const graphemes = boundaries(text);
  const stopCount = Math.max(0, graphemes.length - 1);
  const buffer = new ArrayBuffer(count * 21 + 4 + stopCount * 4);
  const widths = new Float64Array(buffer, 0, count);
  const clusterStarts = new Uint32Array(buffer, count * 8, count);
  const clusterEnds = new Uint32Array(buffer, count * 12, count);
  const stopStarts = new Uint32Array(buffer, count * 16, count + 1);
  const stops = new Uint32Array(buffer, count * 20 + 4, stopCount);
  const breaks = new Uint8Array(buffer, count * 20 + 4 + stopCount * 4, count);
  const starts = new Uint32Array(count + 1);
  const fonts = new Uint8Array(glyphCount);
  const slots = new Uint32Array(glyphCount);
  const advance = new Float64Array(glyphCount);
  const dx = new Float64Array(glyphCount);
  const dy = new Float64Array(glyphCount);
  const ids = Array.from(counts, n => new Uint16Array(n));
  counts.fill(0);
  let cluster = -1, glyph = 0;
  previous = -1;

  for (const run of runs) for (let i = 0; i < run.words[0]; i++, glyph++) {
    const p = 3 + i * 5, start = run.words[p + 1] + run.offset;

    if (start !== previous) {
      if (cluster >= 0) clusterEnds[cluster] = start;
      cluster++;
      clusterStarts[cluster] = start;
      starts[cluster] = glyph;
      previous = start;
    }

    const slot = counts[run.font]++;
    ids[run.font][slot] = run.words[p];
    fonts[glyph] = run.font;
    slots[glyph] = slot * 2;
    advance[glyph] = run.floats[p + 2] * run.scale;
    dx[glyph] = run.floats[p + 3] * run.scale;
    dy[glyph] = run.floats[p + 4] * run.scale;
    widths[cluster] += advance[glyph];
  }

  if (count) clusterEnds[count - 1] = text.length;
  starts[count] = glyphCount;
  let cursor = 0, stop = 1, boundary = 0;

  for (let c = 0; c < count; c++) {
    stopStarts[c] = cursor;

    while (stop < graphemes.length && graphemes[stop] <= clusterEnds[c]) {
      if (graphemes[stop] > clusterStarts[c]) stops[cursor++] = graphemes[stop];
      stop++;
    }

    while (boundary < lineBreaks.length && lineBreaks[boundary] < clusterEnds[c]) boundary++;
    breaks[c] = Number(lineBreaks[boundary] === clusterEnds[c]);
  }

  stopStarts[count] = cursor;
  const glyphs = { starts, fonts, slots, advance, dx, dy, ids };

  const bytes = buffer.byteLength + starts.byteLength + fonts.byteLength + slots.byteLength
    + advance.byteLength + dx.byteLength + dy.byteLength + ids.reduce((n, id) => n + id.byteLength, 0);

  return { clusterStarts, clusterEnds, widths, stopStarts, stops: stops.subarray(0, cursor), breaks, glyphs, bytes };
}

export type PackedShaping = ReturnType<typeof decodeShaping>;
