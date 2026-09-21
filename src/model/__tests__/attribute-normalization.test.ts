import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createSchema, defineNode, defineMark, defineInline, createDocumentCodec } from '../index';

const line = defineNode({
  name: 'line',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string(), rank: z.string().transform(Number) }),
    outputAttributes: z.strictObject({ text: z.string().max(20), rank: z.number() }),
    content: { kind: 'text', field: 'text', marks: 'marks', inline: 'inline' },
  }),
});

const score = defineMark({
  name: 'score',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.number().transform((value) => value + 1),
    outputAttributes: z.number(),
  }),
});

const token = defineInline({
  plainText: (attrs) => String(attrs.value),
  name: 'token',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ value: z.string().transform(Number) }),
    outputAttributes: z.strictObject({ value: z.number() }),
  }),
});

test('normalization runs only at import and creation, never during editing or persistence', () => {
  const schema = createSchema({ extensions: [line, score, token] });

  const result = schema['~standard'].validate([
    {
      kind: 'line',
      text: 'Hi\ufffc',
      rank: '1',
      marks: [{ from: 0, to: 2, mark: { type: 'score', attrs: 1 } }],
      inline: [{ type: 'token', id: 'token', index: 2, attrs: { value: '3' } }],
    },
  ]);

  if (result.issues) throw new Error(JSON.stringify(result.issues));
  const node = result.value[0];
  const edited = schema.editing(node).replace(node, 0, 0, '!');
  expect(schema.editing(node).marks?.validate?.([node.marks[0].mark])[0].attrs).toBe(2);
  expect(edited.rank).toBe(1);
  expect(edited.marks[0].mark.attrs).toBe(2);
  expect(edited.inline[0].attrs).toEqual({ value: 3 });
  expect(() => schema.editing(node).replace(node, 0, 0, 'x'.repeat(21))).toThrow(/Too big/);
  const codec = createDocumentCodec(schema);
  expect(codec.decode(codec.encode([edited]))).toEqual([edited]);
  const mark = schema.marks.create('score', 4);
  expect(mark.attrs).toBe(5);
  expect(
    schema.marks.decode('hi', schema.marks.encode([{ from: 0, to: 2, mark }]))[0].mark.attrs,
  ).toBe(5);
  const value = schema.inline.create('token', 'new', 0, { value: '7' });
  expect(schema.inline.decode('\ufffc', schema.inline.encode([value]))).toEqual([value]);
});

test('non-idempotent attribute normalization requires a canonical output validator', () => {
  const mark = defineMark({
    name: 'increment',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.number().transform((value) => value + 1) }),
  });

  const schema = createSchema({ extensions: [mark] });
  expect(() => schema.marks.create('increment', 1)).toThrow(/outputAttributes/);
});

test('canonical validators cannot transform or silently drop persisted attributes', () => {
  const mark = defineMark({
    name: 'changing',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.number(),
      outputAttributes: z.number().transform((value) => value + 1),
    }),
  });

  const schema = createSchema({ extensions: [mark] });
  expect(() => schema.marks.create('changing', 2)).toThrow(/must not normalize/);
  expect(() =>
    schema.marks.decode('x', [
      { from: 0, to: 1, mark: { type: 'changing', version: 1, attrs: 2 } },
    ]),
  ).toThrow(/must not normalize/);
});

test.each(['return', 'throw'])(
  'canonical validator mutation followed by %s cannot alter existing content',
  (mode) => {
    let mutate = false;

    const outputAttributes: StandardSchemaV1<{ count: number }, { count: number }> = {
      '~standard': {
        version: 1,
        vendor: 'mutation-test',
        validate(value) {
          if (
            value === null ||
            // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The deliberately mutating validator must check, not clone, its unknown argument.
            typeof value !== 'object' ||
            !('count' in value) ||
            // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Preserve argument identity to test in-place validator mutation.
            typeof value.count !== 'number'
          )
            return { issues: [{ message: 'Expected a count' }] };

          if (mutate) {
            value.count++;

            if (mode === 'throw') throw new Error('Mutated before failure');
          }

          return { value: { count: value.count } };
        },
      },
    };

    const mark = defineMark({
      name: 'count',
      version: 1,
      options: {},
      schema: () => ({ attributes: z.strictObject({ count: z.number() }), outputAttributes }),
    });

    const schema = createSchema({ extensions: [mark] });
    const value = schema.marks.create('count', { count: 1 });
    mutate = true;
    expect(() => schema.marks.encode([{ from: 0, to: 1, mark: value }])).toThrow(
      mode === 'throw' ? /Mutated/ : /must not normalize/,
    );
    expect(value.attrs.count).toBe(1);
  },
);
