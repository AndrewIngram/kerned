import { BN_LIKE_TYPES, getBidiCharType, TRAILING_TYPES, TYPES } from './properties.js';
import { getEmbeddingLevels } from './resolve.js';

export type TextDirection = 'auto' | 'ltr' | 'rtl';

/** Logical scalar order with an explicit map to the editor's UTF-16 positions. */
export function analyzeBidi(text: string, direction: TextDirection = 'auto') {
  let count = 0;

  for (let i = 0; i < text.length; count++) i += (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
  const points = new Uint32Array(count);
  const offsets = new Uint32Array(count + 1);

  let scalar = 0,
    offset = 0;

  for (const char of text) {
    points[scalar] = char.codePointAt(0) ?? 0;
    offsets[scalar++] = offset;
    offset += char.length;
  }

  offsets[count] = text.length;
  const { levels, paragraphs } = getEmbeddingLevels(points, direction);

  return { points, offsets, levels, paragraphs };
}

export type BidiAnalysis = ReturnType<typeof analyzeBidi>;

/** Compose whole shaping clusters while retaining their logical identities. */
export function bidiClusters(
  analysis: BidiAnalysis,
  starts: ArrayLike<number>,
  first: number,
  end: number,
  textEnd: number,
) {
  function scalarAt(offset: number) {
    let low = 0,
      high = analysis.offsets.length;

    while (low < high) {
      const middle = (low + high) >>> 1;

      if (analysis.offsets[middle] < offset) low = middle + 1;
      else high = middle;
    }

    return low;
  }

  const scalarStart = scalarAt(starts[first] ?? 0);
  const scalarEnd = scalarAt(textEnd);
  const line = bidiLine(analysis, scalarStart, scalarEnd);

  const levels = Uint8Array.from(
    { length: end - first },
    (_, i) => line.levels[scalarAt(starts[first + i]) - scalarStart],
  );

  const order = Uint32Array.from({ length: end - first }, (_, i) => i);
  reorder(levels, order, 0);

  return { order: order.map((index) => first + index), levels };
}

/** UAX #9 L1/L2. Ranges are half-open scalar indices and may not cross paragraphs.
 * This orders characters for conformance; composition must order whole glyph clusters.
 */
export function bidiLine(analysis: BidiAnalysis, start: number, end: number) {
  const paragraph = analysis.paragraphs.find((entry) => start >= entry.start && start <= entry.end);

  if (
    start < 0 ||
    end < start ||
    end > analysis.points.length ||
    (paragraph && end > paragraph.end + 1)
  )
    throw new RangeError('Bidi line must lie within one paragraph');
  const base = paragraph?.level ?? 0;
  const levels = analysis.levels.slice(start, end);

  for (let i = start; i < end; i++) {
    if (i === end - 1 || getBidiCharType(analysis.points[i]) & (TYPES.B | TYPES.S))
      for (let j = i; j >= start && getBidiCharType(analysis.points[j]) & TRAILING_TYPES; j--)
        levels[j - start] = base;
  }

  // X9 controls are not visual characters. Keep original scalar identities for mapping.
  const order = Uint32Array.from({ length: end - start }, (_, i) => start + i).filter(
    (index) => !(getBidiCharType(analysis.points[index]) & BN_LIKE_TYPES),
  );

  reorder(levels, order, start);

  return { levels, order };
}

function reorder(levels: Uint8Array, order: Uint32Array, start: number) {
  let highest = 0,
    lowestOdd = 126;

  for (const index of order) {
    const level = levels[index - start];
    highest = Math.max(highest, level);

    if (level & 1) lowestOdd = Math.min(lowestOdd, level);
  }

  for (let level = highest; level >= lowestOdd; level--) {
    for (let i = 0; i < order.length;) {
      if (levels[order[i] - start] < level) {
        i++;
        continue;
      }

      const first = i++;

      while (i < order.length && levels[order[i] - start] >= level) i++;

      for (let left = first, right = i - 1; left < right; left++, right--)
        [order[left], order[right]] = [order[right], order[left]];
    }
  }
}
