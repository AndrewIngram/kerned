const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const words = new Intl.Segmenter(undefined, { granularity: 'word' });

// Some WebKit versions include the preceding grapheme when containing() is
// queried at a high surrogate. Query its low surrogate, which is in the same
// Unicode scalar, without changing the returned segment's UTF-16 coordinates.
function segmentOffset(text: string, offset: number) {
  return (text.codePointAt(offset) ?? 0) > 0xffff ? offset + 1 : offset;
}

/** Returns the word, punctuation, or whitespace segment at a text position. */
export function wordRange(text: string, offset: number): { from: number; to: number } {
  const index = Math.max(0, Math.min(offset, text.length - 1));
  const segment = words.segment(text).containing(segmentOffset(text, index));

  return segment
    ? { from: segment.index, to: segment.index + segment.segment.length }
    : { from: 0, to: 0 };
}

export function boundaries(text: string): number[] {
  return [...graphemes.segment(text)].map((s) => s.index).concat(text.length);
}

// Between two ASCII code units only CR/LF can share a grapheme. Other scripts,
// combining marks and surrogate pairs still go through Unicode segmentation.
function asciiBoundary(text: string, offset: number) {
  const before = text.charCodeAt(offset - 1),
    after = text.charCodeAt(offset);

  return before < 128 && after < 128 && !(before === 13 && after === 10);
}

/** Snap one UTF-16 offset without materializing every grapheme in the text. */
export function snapTextOffset(text: string, offset: number, association: -1 | 1): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
    throw new Error('Invalid text offset');

  if (offset === 0 || offset === text.length || asciiBoundary(text, offset)) return offset;
  const segment = graphemes.segment(text).containing(segmentOffset(text, offset));

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
  const interior = [from, to].filter(
    (offset) => offset !== 0 && offset !== text.length && !asciiBoundary(text, offset),
  );

  if (!interior.length) return;
  const segments = graphemes.segment(text);

  if (interior.some((offset) => segments.containing(segmentOffset(text, offset))?.index !== offset))
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
