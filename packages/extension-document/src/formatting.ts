import { createSchema, normalizeMarks, type MarkRange } from '@gprose/model';
import type { TextSpan } from '@gprose/view';

export type FormattingSpan = TextSpan & { underline?: boolean };

import { formattingDefinitions } from './definitions.js';

export type TextFormat = (typeof formattingDefinitions)[number]['name'];

const formats = formattingDefinitions.map((definition) => definition.name);

const formattingSchema = createSchema({ extensions: formattingDefinitions }).marks;

export function formattingMarks(spans: readonly FormattingSpan[]) {
  return normalizeMarks(
    spans.flatMap((span) =>
      formats.flatMap((type) =>
        span[type]
          ? [{ from: span.start, to: span.end, mark: formattingSchema.create(type, null) }]
          : [],
      ),
    ),
  );
}

/** Project semantic marks to the compact font-style runs consumed by layout. */
export function formattingSpans(ranges: readonly MarkRange[]): FormattingSpan[] {
  const points = [...new Set(ranges.flatMap((range) => [range.from, range.to]))].toSorted(
      (a, b) => a - b,
    ),
    spans: FormattingSpan[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i],
      end = points[i + 1],
      active = ranges.filter((range) => range.from <= start && range.to >= end);

    const style = {
      bold: active.some((range) => range.mark.type === 'bold'),
      italic: active.some((range) => range.mark.type === 'italic'),
      underline: active.some((range) => range.mark.type === 'underline'),
    };

    if (!style.bold && !style.italic && !style.underline) continue;
    const previous = spans.at(-1);

    if (
      previous &&
      previous.end === start &&
      previous.bold === style.bold &&
      previous.italic === style.italic &&
      !!previous.underline === style.underline
    )
      previous.end = end;
    else spans.push({ start, end, ...style });
  }

  return spans;
}
