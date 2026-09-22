import { boundaries } from '@gprose/model';

export const emojiSequence = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;

/** Scripts supported by the layout pipeline. Font coverage is configured separately. */
export function supportsLayoutText(text: string) {
  if (/^[\x20-\x7e\n]*$/.test(text)) return true;

  if (
    /[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Han}\p{Script=Bopomofo}\p{Script=Common}\p{Script=Inherited}]/u.test(
      text,
    ) ||
    /[\p{Zl}\p{Zp}]/u.test(text) ||
    // oxlint-disable-next-line eslint/no-control-regex -- Reject unsupported control characters in one scan; newline remains allowed.
    /[\x00-\x09\x0b-\x1f\x7f]/.test(text)
  )
    return false;

  const controls = text.replace(/[\u061c\u200c-\u200f\u202a-\u202e\u2066-\u2069]/g, '');

  if (!/\p{Cf}/u.test(controls)) return true;
  const stops = boundaries(text);

  return stops.slice(0, -1).every((start, i) => {
    const value = text.slice(start, stops[i + 1]);

    return (
      !/\p{Cf}/u.test(value) ||
      (emojiSequence.test(value) && !/[\p{Cf}]/u.test(value.replaceAll('\u200d', '')))
    );
  });
}
