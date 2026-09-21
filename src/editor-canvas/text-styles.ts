import type { ReadTextStyle, TextStyle } from '../editor-browser/text-style';
import type { createOwnedEngine } from '../owned-layout';
import type { createDOMFonts } from './dom-fonts';
import type { TextPresentation } from './scene';

/** Cache immutable resolved styles by presentation identity, outside native render and paint loops. */
export function createTextStyles(
  read: (id: number) => TextPresentation | null,
  fonts: Awaited<ReturnType<typeof createDOMFonts>>,
  metrics: Awaited<ReturnType<typeof createOwnedEngine>>['textMetrics'],
): ReadTextStyle {
  const cache = new WeakMap<TextPresentation, Map<number, TextStyle>>();

  return (id, marks = {}) => {
    const presentation = read(id);

    if (!presentation) return null;
    const key = Number(!!marks.bold) + Number(!!marks.italic) * 2;
    let styles = cache.get(presentation);
    const cached = styles?.get(key);

    if (cached) return cached;

    if (!styles) {
      styles = new Map();
      cache.set(presentation, styles);
    }

    const selection = presentation.font ?? {};

    const resolved = fonts.resolve({
      ...selection,
      weight: marks.bold ? Math.max(700, selection.weight ?? 400) : selection.weight,
      style: marks.italic ? 'italic' : selection.style,
    });

    const style: TextStyle = Object.freeze({
      size: presentation.size,
      lineHeight: presentation.lineHeight,
      before: presentation.before,
      after: presentation.after,
      baselineGrid: presentation.baselineGrid,
      baselineOffset: metrics(presentation).baselineOffset,
      font: Object.freeze(resolved.font),
      cssFamily: resolved.cssFamily,
    });

    styles.set(key, style);

    return style;
  };
}
