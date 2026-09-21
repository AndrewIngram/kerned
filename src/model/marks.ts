import { z } from 'zod';

import {
  jsonValue,
  jsonArray,
  jsonRecord,
  jsonNumber,
  jsonString,
  type JsonValue,
} from './schema-codec';
import { validateTextRange } from './text';

export type Mark = Readonly<{ type: string; attrs: JsonValue }>;

export type MarkRange = Readonly<{ from: number; to: number; mark: Mark }>;

export type MarkExtension = {
  name: string;
  version: number;
  /** Parse and normalize attributes at the schema boundary. */
  parse(attrs: JsonValue): JsonValue;
  inclusiveStart?: boolean;
  inclusiveEnd?: boolean;
};

const jsonObject = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);

function key(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(key).join(',')}]`;
  const record = jsonObject.safeParse(value);

  if (!record.success) return JSON.stringify(value);
  const attrs = jsonRecord(value);

  return `{${Object.keys(attrs)
    .toSorted()
    .map((name) => `${JSON.stringify(name)}:${key(attrs[name])}`)
    .join(',')}}`;
}

export function sameMark(a: Mark, b: Mark) {
  return a.type === b.type && key(a.attrs) === key(b.attrs);
}

/** Different mark types can overlap; one type has at most one value at each point. */
export function setMark(
  ranges: readonly MarkRange[],
  from: number,
  to: number,
  mark: Mark,
): MarkRange[] {
  if (from === to) return [...ranges];

  return normalizeMarks([...removeMark(ranges, from, to, mark.type), { from, to, mark }]);
}

export function removeMark(
  ranges: readonly MarkRange[],
  from: number,
  to: number,
  type?: string,
): MarkRange[] {
  if (from === to) return [...ranges];

  return ranges.flatMap((range) =>
    range.to <= from || range.from >= to || (type !== undefined && range.mark.type !== type)
      ? [range]
      : [
          ...(range.from < from ? [{ ...range, to: from }] : []),
          ...(range.to > to ? [{ ...range, from: to }] : []),
        ],
  );
}

export function hasMark(
  ranges: readonly MarkRange[],
  from: number,
  to: number,
  mark: Mark,
): boolean {
  if (from >= to) return false;
  let covered = from;

  for (const range of ranges
    .filter((range) => sameMark(range.mark, mark))
    .toSorted((a, b) => a.from - b.from)) {
    if (range.from > covered) break;
    covered = Math.max(covered, range.to);

    if (covered >= to) return true;
  }

  return false;
}

export function normalizeMarks<Range extends MarkRange>(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].toSorted(
      (a, b) =>
        (a.mark.type < b.mark.type ? -1 : a.mark.type > b.mark.type ? 1 : 0) ||
        a.from - b.from ||
        a.to - b.to,
    ),
    result: Range[] = [];

  for (const range of sorted) {
    if (
      !Number.isSafeInteger(range.from) ||
      !Number.isSafeInteger(range.to) ||
      range.from < 0 ||
      range.from >= range.to
    )
      throw new Error('Invalid mark range');
    const previous = result.at(-1);

    if (previous?.mark.type === range.mark.type && previous.to >= range.from) {
      if (sameMark(previous.mark, range.mark)) {
        result[result.length - 1] = { ...previous, to: Math.max(previous.to, range.to) };
        continue;
      }

      if (previous.to > range.from) throw new Error('Conflicting values for a mark type');
    }

    result.push(range);
  }

  return result.toSorted(
    (a, b) =>
      a.from - b.from ||
      a.to - b.to ||
      (a.mark.type < b.mark.type ? -1 : a.mark.type > b.mark.type ? 1 : 0),
  );
}

export function sliceMarks(ranges: readonly MarkRange[], from: number, to: number): MarkRange[] {
  return ranges.flatMap((range) =>
    range.from < to && range.to > from
      ? [{ ...range, from: Math.max(range.from, from) - from, to: Math.min(range.to, to) - from }]
      : [],
  );
}

export function createMarkSchema(extensions: readonly MarkExtension[]) {
  const registry = new Map<string, MarkExtension>();

  for (const extension of extensions) {
    if (
      !extension.name ||
      !Number.isSafeInteger(extension.version) ||
      extension.version < 1 ||
      registry.has(extension.name)
    )
      throw new Error('Invalid or duplicate mark extension');
    registry.set(extension.name, extension);
  }

  function create(type: string, attrs: JsonValue): Mark {
    const extension = registry.get(type);

    if (!extension) throw new Error(`Unknown mark: ${type}`);

    return { type, attrs: jsonValue(extension.parse(attrs)) };
  }

  function validate(text: string, ranges: readonly MarkRange[]): MarkRange[] {
    return normalizeMarks(
      ranges.map((range) => {
        validateTextRange(text, range.from, range.to);

        return { ...range, mark: create(range.mark.type, range.mark.attrs) };
      }),
    );
  }

  return {
    boundary(this: void, mark: Mark, edge: 'start' | 'end'): boolean | undefined {
      const extension = registry.get(mark.type);

      if (!extension) throw new Error(`Unknown mark: ${mark.type}`);

      return edge === 'start' ? extension.inclusiveStart : extension.inclusiveEnd;
    },
    encode(ranges: readonly MarkRange[]): JsonValue[] {
      return ranges.map((range) => {
        const mark = create(range.mark.type, range.mark.attrs);

        return {
          from: range.from,
          to: range.to,
          mark: { ...mark, version: registry.get(mark.type)!.version },
        };
      });
    },
    decode(text: string, value: JsonValue): MarkRange[] {
      return validate(
        text,
        jsonArray(value).map((valueValue) => {
          const range = jsonRecord(valueValue),
            data = jsonRecord(range.mark),
            type = jsonString(data.type),
            extension = registry.get(type);

          if (!extension || data.version !== extension.version)
            throw new Error(`Unsupported mark version: ${type}`);

          return {
            from: jsonNumber(range.from),
            to: jsonNumber(range.to),
            mark: create(type, data.attrs),
          };
        }),
      );
    },
    manifest: extensions.map(({ name, version }) => ({ name, version })),
    create,
    validate,
  };
}
