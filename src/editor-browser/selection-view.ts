import { wordRange } from '@gprose/model';
import { TextSelection } from '@gprose/state';

export function textSelectionAtClick(
  text: string,
  id: number,
  offset: number,
  upstream: boolean,
  clicks: number,
): TextSelection | null {
  if (clicks < 2) return null;

  const range =
    clicks >= 3 ? { from: 0, to: text.length } : wordRange(text, offset - (upstream ? 1 : 0));

  return new TextSelection({ id, offset: range.from }, { id, offset: range.to });
}
