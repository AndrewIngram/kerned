import { boundaries } from '@gprose/model';

export const emojiSequence = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;

/** The owned composer remains LTR. Joiners are accepted only inside emoji. */
export function supportsLayoutText(text: string) {
  if (/^[\x20-\x7e\n]*$/.test(text)) return true;

  if (
    /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(text) ||
    /[\p{Zl}\p{Zp}]/u.test(text) ||
    // oxlint-disable-next-line eslint/no-control-regex -- Reject unsupported control characters in one scan; newline remains allowed.
    /[\x00-\x09\x0b-\x1f\x7f]/.test(text)
  )
    return false;

  if (!/\p{Cf}/u.test(text)) return true;
  const stops = boundaries(text);

  return stops.slice(0, -1).every((start, i) => {
    const value = text.slice(start, stops[i + 1]);

    return (
      !/\p{Cf}/u.test(value) ||
      (emojiSequence.test(value) && !/[\p{Cf}]/u.test(value.replaceAll('\u200d', '')))
    );
  });
}
