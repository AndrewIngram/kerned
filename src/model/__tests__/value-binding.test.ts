import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createSchema, defineMark, defineInline, defineNode } from '../index';

const text = defineNode({
  name: 'text',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text', marks: 'marks', inline: 'inline' },
  }),
});

test('value bindings retain normalized canonical attributes without rerunning validators', () => {
  let reads = 0;

  const highlight = defineMark({
    name: 'highlight',
    version: 1,
    options: { color: 'gold' },
    schema: (options) => ({
      attributes: z
        .strictObject({ color: z.string().default(options.color) })
        .transform((attrs) => {
          reads++;

          return attrs;
        }),
      outputAttributes: z.strictObject({ color: z.string() }),
    }),
  });

  const schema = createSchema({ extensions: [text, highlight.configure({ color: 'blue' })] });
  const value = schema.marks.create('highlight', {});
  const binding = schema.value(highlight);
  expectTypeOf(binding.read(value)).toEqualTypeOf<Readonly<{
    attrs: { readonly color: string };
  }> | null>();
  expect(binding.read(value)).toBe(value);
  expect(binding.read(value)?.attrs.color).toBe('blue');
  expect(binding.read(value)).toBe(value);
  expect(reads).toBe(1);
  expect(binding.read({ type: 'another', attrs: null })).toBeNull();
});

test('null mark attributes remain distinguishable from a nonmatching value', () => {
  const bold = defineMark({
    name: 'bold',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.null() }),
  });

  const schema = createSchema({ extensions: [text, bold] });
  expect(schema.value(bold).read(schema.marks.create('bold', null))).toEqual({
    type: 'bold',
    attrs: null,
  });
});

test('inline bindings recognize configured families and reject unrelated or missing definitions', () => {
  const badge = defineInline({
    name: 'badge',
    version: 1,
    options: { label: 'Badge' },
    schema: (options) => ({
      attributes: z.strictObject({ label: z.string().default(options.label) }),
    }),
    plainText: (attrs) => attrs.label,
  });

  const schema = createSchema({ extensions: [text, badge.configure({ label: 'Configured' })] });
  const value = schema.inline.create('badge', 'one', 0, {});
  expect(schema.value(badge).read(value)?.attrs.label).toBe('Configured');

  const imposter = defineMark({
    name: 'badge',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.null() }),
  });

  expect(() => schema.value(imposter)).toThrow(/Different mark definition/);
  expect(() => createSchema({ extensions: [text] }).value(badge)).toThrow(
    /Missing inline definition/,
  );
});
