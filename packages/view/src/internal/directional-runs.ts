import { type BidiAnalysis } from './bidi/paragraph.js';
import { boundaries, type Span } from './layout-types.js';
import { emojiSequence } from './owned-text-support.js';

type Run = { start: number; end: number; level: number; script: number; font: number };

const scripts = [
  { pattern: /\p{Script=Han}/u, tag: 0x48616e69 },
  { pattern: /\p{Script=Bopomofo}/u, tag: 0x426f706f },
  { pattern: /\p{Script=Arabic}/u, tag: 0x41726162 },
  { pattern: /\p{Script=Hebrew}/u, tag: 0x48656272 },
  { pattern: /\p{Script=Latin}/u, tag: 0x4c61746e },
  { pattern: /\p{Script=Greek}/u, tag: 0x4772656b },
  { pattern: /\p{Script=Cyrillic}/u, tag: 0x4379726c },
];

/** Intersect graphemes, resolved bidi levels, scripts and marks before font fallback.
 * Common/inherited characters adopt a neighboring script; they do not split every word.
 */
export function directionalRuns(
  text: string,
  spans: readonly Span[],
  bidi: BidiAnalysis,
  fonts: {
    marked(marks: { bold: boolean; italic: boolean }): number;
    covering(id: number, text: string): number | undefined;
    emoji: number;
  },
  from = 0,
  to = text.length,
) {
  const stops = boundaries(text.slice(from, to)).map((offset) => offset + from);

  const tags = stops
    .slice(0, -1)
    .map(
      (start, i) =>
        scripts.find(({ pattern }) => pattern.test(text.slice(start, stops[i + 1])))?.tag ?? 0,
    );

  let previous = 0;

  for (let i = 0; i < tags.length; i++) {
    if (tags[i]) previous = tags[i];
    else tags[i] = previous;
  }

  let following = 0x4c61746e;

  for (let i = tags.length - 1; i >= 0; i--) {
    if (tags[i]) following = tags[i];
    else tags[i] = following;
  }

  const runs: Run[] = [];

  const events = spans
    .flatMap((span) => [
      { at: span.start, bold: Number(span.bold), italic: Number(span.italic) },
      { at: span.end, bold: -Number(span.bold), italic: -Number(span.italic) },
    ])
    .toSorted((a, b) => a.at - b.at);

  let event = 0,
    bold = 0,
    italic = 0;

  let low = 0,
    high = bidi.levels.length;

  while (low < high) {
    const mid = (low + high) >>> 1;

    if (bidi.offsets[mid] <= from) low = mid + 1;
    else high = mid;
  }

  let scalar = Math.max(0, low - 1);

  for (let i = 0; i < stops.length - 1; i++) {
    const start = stops[i],
      end = stops[i + 1];

    while (bidi.offsets[scalar + 1] <= start && scalar + 1 < bidi.levels.length) scalar++;
    const value = text.slice(start, end);

    while (event < events.length && events[event].at <= start) {
      bold += events[event].bold;
      italic += events[event].italic;
      event++;
    }

    const emoji = emojiSequence.test(value) && !value.includes('\ufe0e');

    const font = emoji
      ? fonts.emoji
      : fonts.marked({
          bold: bold > 0,
          italic: italic > 0,
        });

    const run = { start, end, level: bidi.levels[scalar] ?? 0, script: emoji ? 0 : tags[i], font };
    const last = runs.at(-1);

    if (last && last.level === run.level && last.script === run.script && last.font === font)
      last.end = end;
    else runs.push(run);
  }

  return runs.flatMap((run) => {
    if (run.font === fonts.emoji) return [run];
    const textValue = text.slice(run.start, run.end);
    const font = fonts.covering(run.font, textValue);

    if (font !== undefined) return [{ ...run, font }];
    const points = boundaries(textValue);
    const fallback: Run[] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const start = run.start + points[i],
        end = run.start + points[i + 1];

      const chosen = fonts.covering(run.font, text.slice(start, end)) ?? run.font;
      const last = fallback.at(-1);

      if (last?.font === chosen) last.end = end;
      else fallback.push({ ...run, start, end, font: chosen });
    }

    return fallback;
  });
}

/** Build once per uploaded paragraph; UTF-16 offsets at the view boundary remain unchanged. */
export function utf8Offsets(text: string) {
  const offsets = new Uint32Array(text.length + 1);

  let unit = 0,
    byte = 0;

  for (const char of text) {
    offsets[unit] = byte;
    const point = char.codePointAt(0) ?? 0;
    byte += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    unit += char.length;
  }

  offsets[unit] = byte;

  return offsets;
}
