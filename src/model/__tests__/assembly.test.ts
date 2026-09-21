import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createSchema } from '../assembly';
import { defineInline, defineMark, defineNode, type SchemaDefinition } from '../definitions';

const paragraph = defineNode({
  name: 'paragraph',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string(), priority: z.number().default(0) }),
    content: { kind: 'text', field: 'text', marks: 'marks', inline: 'inline' },
  }),
});

const quote = defineNode({
  name: 'quote',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({}),
    content: { kind: 'container', field: 'children', allowed: ['paragraph', 'quote'] },
  }),
});

const link = defineMark({
  name: 'link',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({ href: z.string().startsWith('/') }) }),
});

const mention = defineInline({
  name: 'mention',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({ label: z.string() }), plainText: () => 'mention' }),
});

const schema = createSchema({ extensions: [paragraph, quote, link, mention] });

function issues(value: Parameters<(typeof schema)['~standard']['validate']>[0]) {
  const result = schema['~standard'].validate(value);

  if (!result.issues) throw new Error('Expected validation to fail');

  return result.issues;
}

test('compiled schema satisfies the official contract and owns normalized immutable content', () => {
  expectTypeOf(schema).toExtend<StandardSchemaV1>();
  expectTypeOf(schema.definitions[0]).toEqualTypeOf<typeof paragraph>();

  type Output = StandardSchemaV1.InferOutput<typeof schema>;

  expectTypeOf<
    Extract<Output[number], { kind: 'paragraph' }>['priority']
  >().toEqualTypeOf<number>();

  const input = [
    { kind: 'quote', children: [{ kind: 'paragraph', text: 'Hello', marks: [], inline: [] }] },
  ];

  const result = schema['~standard'].validate(input);

  if (result.issues) throw new Error(JSON.stringify(result.issues));
  const text = result.value[0];
  expect(text.kind).toBe('quote');
  expect(Object.isFrozen(result.value)).toBe(true);
  expect(Object.isFrozen(text)).toBe(true);
  input[0].children[0].text = 'Changed externally';
  expect(result.value).toEqual([
    {
      kind: 'quote',
      id: expect.any(Number),
      key: expect.any(String),
      children: [
        {
          kind: 'paragraph',
          id: expect.any(Number),
          key: expect.any(String),
          text: 'Hello',
          priority: 0,
          marks: [],
          inline: [],
        },
      ],
    },
  ]);
});

test('nested issues retain mark attribute paths and reject unknown types and fields', () => {
  const markIssues = issues([
    {
      kind: 'quote',
      children: [
        {
          kind: 'paragraph',
          text: 'Hi',
          marks: [{ from: 0, to: 2, mark: { type: 'link', attrs: { href: 42 } } }],
        },
      ],
    },
  ]);

  expect(markIssues[0].path).toEqual([0, 'children', 0, 'marks', 0, 'mark', 'attrs', 'href']);
  expect(issues([{ kind: 'missing' }])[0].path).toEqual([0, 'kind']);
  expect(issues([{ kind: 'paragraph', text: 'Hi', typo: true }])[0].message).toMatch(/typo/);
  expect(
    issues([
      {
        kind: 'paragraph',
        text: 'Hi',
        marks: [{ from: 0, to: 2, mark: { type: 'missing', attrs: null } }],
      },
    ])[0].path,
  ).toEqual([0, 'marks', 0, 'mark', 'type']);
});

test('identities reserve supplied handles before allocating and reject duplicates', () => {
  const result = schema['~standard'].validate([
    { kind: 'paragraph', text: 'First' },
    { kind: 'paragraph', id: -1, key: 'provided', text: 'Second' },
  ]);

  if (result.issues) throw new Error(JSON.stringify(result.issues));
  expect(result.value.map((node) => node.id)).toEqual([-2, -1]);
  expect(result.value[1].key).toBe('provided');
  expect(
    issues([
      { kind: 'paragraph', id: 1, key: 'same', text: '' },
      { kind: 'paragraph', id: 1, key: 'same', text: '' },
    ]).map((issue) => issue.path),
  ).toEqual([
    [1, 'id'],
    [1, 'key'],
  ]);
});

test('validation rejects broken inline positions, grapheme cuts and cyclic nodes', () => {
  expect(
    issues([
      {
        kind: 'paragraph',
        text: '😀',
        marks: [{ from: 1, to: 2, mark: { type: 'link', attrs: { href: '/ok' } } }],
      },
    ])[0].message,
  ).toMatch(/grapheme boundaries/);
  expect(
    issues([
      {
        kind: 'paragraph',
        text: 'x',
        inline: [{ type: 'mention', id: 'm', index: 0, attrs: { label: 'Maya' } }],
      },
    ])[0].path,
  ).toEqual([0, 'inline']);
  const descendants: object[] = [];
  const cyclic = { kind: 'quote', children: descendants };
  cyclic.children.push(cyclic);
  expect(issues([cyclic])[0].message).toMatch(/Cyclic/);
});

test('dependency and child constraints are checked before or during content validation', () => {
  expect(() => {
    createSchema({ extensions: [quote] });
  }).toThrow(/Missing node paragraph/);

  const onlyText = defineNode({
    name: 'onlyText',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({}),
      content: { kind: 'container', field: 'children', allowed: ['paragraph'] },
    }),
  });

  const limited = createSchema({ extensions: [paragraph, onlyText, quote] });

  const result = limited['~standard'].validate([
    { kind: 'onlyText', children: [{ kind: 'quote', children: [] }] },
  ]);

  expect(result.issues?.[0].path).toEqual([0, 'children', 0, 'kind']);
  expect(() => {
    createSchema({ extensions: [paragraph, paragraph] });
  }).toThrow(/Duplicate/);
});

test('async validators reject synchronously without an unhandled rejection', async () => {
  const asynchronous = defineMark({
    name: 'async',
    version: 1,
    options: {},
    schema: () => ({
      attributes: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: async () => {
            throw new Error('remote failure');
          },
        },
      },
    }),
  });

  const composed = createSchema({ extensions: [paragraph, asynchronous] });

  const result = composed['~standard'].validate([
    {
      kind: 'paragraph',
      text: 'Hi',
      marks: [{ from: 0, to: 2, mark: { type: 'async', attrs: null } }],
    },
  ]);

  expect(result).not.toBeInstanceOf(Promise);
  expect(result.issues?.[0].message).toMatch(/Asynchronous/);
  await Promise.resolve();
});

test('runtime extension arrays expose a less specific node discriminant', () => {
  const runtime: SchemaDefinition[] = [paragraph, quote];
  const composed = createSchema({ extensions: runtime });
  expectTypeOf<
    StandardSchemaV1.InferOutput<typeof composed>[number]['kind']
  >().toEqualTypeOf<string>();
});

test('mark conflicts and empty ranges produce structured issues instead of throwing', () => {
  const marked = (from: number, to: number, href: string) => ({
    from,
    to,
    mark: { type: 'link', attrs: { href } },
  });

  expect(
    issues([
      { kind: 'paragraph', text: 'abc', marks: [marked(0, 2, '/a'), marked(1, 3, '/b')] },
    ])[0],
  ).toEqual({
    message: 'Conflicting values for a mark type',
    path: [0, 'marks'],
  });
  expect(
    issues([{ kind: 'paragraph', text: 'abc', marks: [marked(1, 1, '/a')] }])[0].message,
  ).toMatch(/Invalid mark range/);
});

test('container constraints validate parent membership, minimum and initial child type', () => {
  const item = defineNode({
    name: 'item',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({}),
      content: {
        kind: 'container',
        field: 'children',
        parents: ['list'],
        minChildren: 1,
        allowed: ['paragraph', 'list'],
        first: ['paragraph'],
      },
    }),
  });

  const list = defineNode({
    name: 'list',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({}),
      content: { kind: 'container', field: 'children', allowed: ['item'], minChildren: 1 },
    }),
  });

  const nested = createSchema({ extensions: [paragraph, item, list] });
  expect(
    nested['~standard']
      .validate([{ kind: 'item', children: [] }])
      .issues?.map((issue) => issue.path),
  ).toEqual([
    [0, 'kind'],
    [0, 'children'],
  ]);
  expect(
    nested['~standard']
      .validate([
        { kind: 'list', children: [{ kind: 'item', children: [{ kind: 'list', children: [] }] }] },
      ])
      .issues?.some((issue) => issue.message === 'Invalid first child for item'),
  ).toBe(true);
  expect(
    nested['~standard'].validate([
      {
        kind: 'list',
        children: [{ kind: 'item', children: [{ kind: 'paragraph', text: 'Valid' }] }],
      },
    ]).issues,
  ).toBeUndefined();
});

test('assembly rejects conflicting storage fields before accepting documents', () => {
  for (const field of ['id', 'text']) {
    const invalid = defineNode({
      name: 'invalid',
      version: 1,
      options: {},
      schema: () => ({
        attributes: z.strictObject({ text: z.string() }),
        content: { kind: 'text', field: 'text', marks: field },
      }),
    });

    expect(() => {
      createSchema({ extensions: [invalid] });
    }).toThrow(/content fields/);
  }
});

test('public mark and inline constructors retain installed names and attribute types', () => {
  const created = schema.marks.create('link', { href: '/path' });
  expectTypeOf(created.type).toEqualTypeOf<'link'>();
  expectTypeOf(created.attrs.href).toEqualTypeOf<string>();
  const inline = schema.inline.create('mention', 'm', 0, { label: 'Maya' });
  expectTypeOf(inline.type).toEqualTypeOf<'mention'>();
  expect(inline.attrs.label).toBe('Maya');

  function invalidConstructions() {
    // @ts-expect-error Uninstalled marks cannot be constructed.
    schema.marks.create('bold', null);
    // @ts-expect-error Mark attributes use the declared input type.
    schema.marks.create('link', { href: 1 });
    // @ts-expect-error Inline attributes use the declared input type.
    schema.inline.create('mention', 'm', 0, { label: 1 });
  }

  void invalidConstructions;
});

test('content groups select installed members and preserve inferred children', () => {
  const line = defineNode({
    name: 'line',
    version: 1,
    options: {},
    schema: () => ({
      groups: ['block'],
      attributes: z.strictObject({ value: z.string() }),
      content: { kind: 'text', field: 'value' },
    }),
  });

  const widget = defineNode({
    name: 'widget',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.strictObject({}), content: { kind: 'atom' } }),
  });

  const container = defineNode({
    name: 'container',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({}),
      content: { kind: 'container', field: 'children', allowedGroups: ['block'], minChildren: 1 },
    }),
  });

  const composed = createSchema({ extensions: [line, widget, container] });

  type Output = StandardSchemaV1.InferOutput<typeof composed>;

  type Child = Extract<Output[number], { kind: 'container' }>['children'][number];

  expectTypeOf<Child['kind']>().toEqualTypeOf<'line'>();

  const result = composed['~standard'].validate([
    { kind: 'container', children: [{ kind: 'line', value: 'Hello' }] },
  ]);

  if (result.issues) throw new Error(JSON.stringify(result.issues));
  const parent = result.value[0];
  expect(composed.children(parent)).toHaveLength(1);

  const invalid = composed['~standard'].validate([
    { kind: 'container', children: [{ kind: 'widget' }] },
  ]);

  expect(invalid.issues?.[0].path).toEqual([0, 'children', 0, 'kind']);
  expect(() =>
    composed.validateChildren(
      composed.withChildren(parent, [{ kind: 'widget', id: 9, key: 'widget' }]),
      null,
    ),
  ).toThrow(/child/i);
});
