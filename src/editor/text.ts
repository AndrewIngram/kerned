const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/** Returns the word, punctuation, or whitespace segment at a text position. */
export function wordRange(text: string, offset: number): { from: number; to: number } {
  const segment = words.segment(text).containing(Math.max(0, Math.min(offset, text.length - 1)));

  return segment
    ? { from: segment.index, to: segment.index + segment.segment.length }
    : { from: 0, to: 0 };
}

export function boundaries(text: string): number[] {
  return [...graphemes.segment(text)].map((s) => s.index).concat(text.length);
}

export function validateTextRange(text: string, from: number, to: number) {
  const stops = new Set(boundaries(text));

  if (from > to || !stops.has(from) || !stops.has(to))
    throw new Error('Edit range must follow grapheme boundaries');
}

/** Word movement uses Unicode segments, with platform-specific forward stops. */
export function wordBoundary(
  text: string,
  offset: number,
  back: boolean,
  platform: 'mac' | 'other',
) {
  const segments = [...words.segment(text)].filter((segment) => segment.isWordLike);

  if (back) return segments.findLast((segment) => segment.index < offset)?.index ?? 0;

  if (platform === 'other')
    return segments.find((segment) => segment.index > offset)?.index ?? text.length;
  const next = segments.find((segment) => segment.index + segment.segment.length > offset);

  return next ? next.index + next.segment.length : text.length;
}
