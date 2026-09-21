import { normalizeMarks, type MarkRange } from '../model';
import type { StarterSpan } from './demo-model';
import { demoSchema } from './demo-schema';
import { formattingDefinitions } from './starter-definitions';

export type TextFormat = (typeof formattingDefinitions)[number]['name'];

const formats = formattingDefinitions.map((definition) => definition.name);

export const formattingSchema = demoSchema.marks;

export function formattingMarks(spans: readonly StarterSpan[]) {
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
export function formattingSpans(ranges: readonly MarkRange[]): StarterSpan[] {
  const points = [...new Set(ranges.flatMap((range) => [range.from, range.to]))].toSorted(
      (a, b) => a - b,
    ),
    spans: StarterSpan[] = [];

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
