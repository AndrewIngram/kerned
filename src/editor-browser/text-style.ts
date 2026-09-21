/** Resolved per-view appearance. Family names are semantic; CSS families are view-owned aliases. */
export type TextStyle = Readonly<{
  color: string;
  size: number;
  lineHeight: number;
  before: number;
  after: number;
  baselineGrid: number;
  baselineOffset: number;
  font: Readonly<{ family: string; weight: number; style: 'normal' | 'italic' }>;
  cssFamily: string;
}>;

export type ReadTextStyle = (
  id: number,
  marks?: Readonly<{ bold?: boolean; italic?: boolean }>,
) => TextStyle | null;

/** Native text and its editing input use exactly the same resolved settings. */
export function applyTextStyle(element: HTMLElement, style: TextStyle) {
  element.style.color = style.color;
  element.style.fontFamily = style.cssFamily;
  element.style.fontWeight = String(style.font.weight);
  element.style.fontStyle = style.font.style;
  element.style.fontSynthesis = 'none';
  element.style.fontSize = `${style.size}px`;
  element.style.lineHeight = `${style.lineHeight}px`;
  element.style.translate = `0 ${style.baselineOffset}px`;
}
