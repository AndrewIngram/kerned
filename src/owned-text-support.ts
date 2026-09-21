import { boundaries } from './model';

export const emojiSequence = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;

/** The owned composer remains LTR. Joiners are accepted only inside emoji. */
export function supportsOwnedText(text: string) {
  if (
    /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(text) ||
    /[\p{Zl}\p{Zp}]/u.test(text)
  )
    return false;

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);

    if (code !== 10 && (code < 32 || code === 127)) return false;
  }

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
