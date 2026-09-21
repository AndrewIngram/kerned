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

/** Snap one UTF-16 offset without materializing every grapheme in the text. */
export function snapTextOffset(text: string, offset: number, association: -1 | 1): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
    throw new Error('Invalid text offset');

  if (offset === 0 || offset === text.length) return offset;
  const segment = graphemes.segment(text).containing(offset);

  if (!segment || segment.index === offset) return offset;

  return association < 0 ? segment.index : segment.index + segment.segment.length;
}

export function validateTextRange(text: string, from: number, to: number) {
  const validOffset = (offset: number) =>
    Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length;

  if (from > to || !validOffset(from) || !validOffset(to))
    throw new Error('Edit range must follow grapheme boundaries');
  // Most imported mark ranges cover a whole block. Interior endpoints need only
  // their containing segment, not an allocated array and Set for the entire text.
  const interior = [from, to].filter((offset) => offset !== 0 && offset !== text.length);

  if (!interior.length) return;
  const segments = graphemes.segment(text);

  if (interior.some((offset) => segments.containing(offset)?.index !== offset))
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
