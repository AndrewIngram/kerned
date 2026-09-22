import { bracketPairs, classRanges, TYPES } from './unicode-data.js';

export { TYPES } from './unicode-data.js';

export const ISOLATE_INIT_TYPES = TYPES.LRI | TYPES.RLI | TYPES.FSI;

export const STRONG_TYPES = TYPES.L | TYPES.R | TYPES.AL;

export const NEUTRAL_ISOLATE_TYPES =
  TYPES.B | TYPES.S | TYPES.WS | TYPES.ON | ISOLATE_INIT_TYPES | TYPES.PDI;

export const BN_LIKE_TYPES = TYPES.BN | TYPES.RLE | TYPES.LRE | TYPES.RLO | TYPES.LRO | TYPES.PDF;

export const TRAILING_TYPES =
  TYPES.S | TYPES.WS | TYPES.B | ISOLATE_INIT_TYPES | TYPES.PDI | BN_LIKE_TYPES;

function lookup(data: Uint32Array, point: number) {
  let lo = 0,
    hi = data.length / 3;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;

    if (data[mid * 3] <= point) lo = mid + 1;
    else hi = mid;
  }

  return (lo - 1) * 3;
}

export function getBidiCharType(point: number): number {
  return classRanges[lookup(classRanges, point) + 2];
}

export function openingToClosingBracket(point: number): number | null {
  const slot = lookup(bracketPairs, point);

  return bracketPairs[slot] === point && bracketPairs[slot + 2] === 1
    ? bracketPairs[slot + 1]
    : null;
}

export function closingToOpeningBracket(point: number): number | null {
  const slot = lookup(bracketPairs, point);

  return bracketPairs[slot] === point && bracketPairs[slot + 2] === 0
    ? bracketPairs[slot + 1]
    : null;
}

// UAX #9 BD16 treats these canonically equivalent angle brackets as pairs.
export function getCanonicalBracket(point: number): number {
  return point === 0x2329 ? 0x3008 : point === 0x232a ? 0x3009 : point;
}
