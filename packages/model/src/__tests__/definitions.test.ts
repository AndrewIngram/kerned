import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import {
  defineMark,
  defineNode,
  defineInline,
  type DocumentInput,
  type DocumentOutput,
} from '../definitions.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ value: z.string(), priority: z.number().default(0) }),
    content: { kind: 'text', field: 'value', marks: 'marks' },
  }),
});

const link = defineMark({
  name: 'link',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({ href: z.string() }) }),
});

const group = defineNode({
  name: 'group',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ label: z.string() }),
    content: { kind: 'container', field: 'items' },
  }),
});

const grid = defineNode({
  name: 'grid',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({}),
    content: { kind: 'container', field: 'rows', depth: 2, groupBy: 'priority', allowed: ['note'] },
  }),
});

const definitions = [note, link, group, grid] as const;

type Input = DocumentInput<typeof definitions>;

type Output = DocumentOutput<typeof definitions>;

const nested: Input = [
  {
    kind: 'group',
    label: 'Notes',
    items: [
      {
        kind: 'note',
        value: 'Read',
        marks: [{ from: 0, to: 4, mark: { type: 'link', attrs: { href: '/read' } } }],
      },
    ],
  },
];

test('content unions include installed names, custom storage and attribute normalization', () => {
  expect(nested[0].kind).toBe('group');
  expectTypeOf<Extract<Input[number], { kind: 'note' }>['priority']>().toEqualTypeOf<
    number | undefined
  >();
  expectTypeOf<Extract<Output[number], { kind: 'note' }>['priority']>().toEqualTypeOf<number>();
  expectTypeOf<Output[number]['id']>().toEqualTypeOf<number>();
  expectTypeOf<
    Extract<Output[number], { kind: 'grid' }>['rows'][number][number]['kind']
  >().toEqualTypeOf<'note'>();

  const missing: DocumentInput<readonly [typeof note]> = [
    {
      // @ts-expect-error A removed extension cannot be constructed.
      kind: 'group',
      label: 'No',
      items: [],
    },
  ];

  const badLink: Extract<Output[number], { kind: 'note' }>['marks'][number]['mark'] = {
    type: 'link',
    // @ts-expect-error Mark attributes retain the validator's output type.
    attrs: { href: 4 },
  };

  // @ts-expect-error Attribute defaults are required in normalized output.
  const missingDefault: Output[number] = {
    kind: 'note',
    id: 1,
    key: 'a',
    value: 'Text',
    marks: [],
  };

  void missing;
  void badLink;
  void missingDefault;
});

test('configuration creates an independent definition with a newly configured validator', () => {
  const heading = defineNode({
    name: 'heading',
    version: 1,
    options: { maxLevel: 4 },
    schema: (options) => ({
      attributes: z.strictObject({
        level: z.number().int().min(1).max(options.maxLevel),
        text: z.string(),
      }),
      content: { kind: 'text', field: 'text' },
    }),
  });

  const smaller = heading.configure({ maxLevel: 2 });

  expect(smaller.options.maxLevel).toBe(2);
  expect(heading.options.maxLevel).toBe(4);
  expect(smaller.spec.attributes.safeParse({ level: 3, text: 'Title' }).success).toBe(false);
  expect(heading.spec.attributes.safeParse({ level: 3, text: 'Title' }).success).toBe(true);
});

test('definitions own configuration and child-policy data without freezing supplied objects', () => {
  const allowed = ['note'];

  const config = {
    name: 'owned',
    version: 1,
    options: { label: 'Original' },
    schema: () => ({
      attributes: z.strictObject({}),
      content: { kind: 'container' as const, field: 'children', allowed },
    }),
  };

  const owned = defineNode(config);
  config.name = 'mutated';
  config.version = 99;
  allowed.push('group');
  expect(owned.configure({ label: 'Configured' }).name).toBe('owned');
  expect(owned.configure({ label: 'Configured' }).version).toBe(1);
  expect(owned.spec.content.allowed).toEqual(['note']);
  expect(Object.isFrozen(owned.spec.content)).toBe(true);
  expect(Object.isFrozen(allowed)).toBe(false);
});

test('import defaults are optional and normalized output exposes immutable descendants', () => {
  const minimal: Input = [
    { kind: 'note', value: 'No explicit marks' },
    { kind: 'group', label: 'Empty' },
  ];

  expect(minimal).toHaveLength(2);

  // Compile-time contract only: never execute mutations of validated values.
  function invalidMutation(value: Output) {
    // @ts-expect-error The normalized document array is immutable.
    value.push(value[0]);
    // @ts-expect-error Normalized node fields are immutable.
    value[0].key = 'changed';
    const node = value[0];

    if (node.kind === 'note') {
      // @ts-expect-error Nested marks are immutable too.
      node.marks.push(node.marks[0]);
      // @ts-expect-error Normalized mark attributes cannot be changed in place.
      node.marks[0].mark.attrs.href = '/mutated';
    }
  }

  void invalidMutation;
});

test('configured options expose immutable nested values without sharing caller objects', () => {
  const options = { tags: ['first'], presentation: { label: 'Original' } };

  const definition = defineNode({
    name: 'configured',
    version: 1,
    options,
    schema: () => ({ attributes: z.strictObject({}), content: { kind: 'atom' } }),
  });

  options.tags.push('outside');
  options.presentation.label = 'Changed';
  expect(definition.options.tags).toEqual(['first']);
  expect(definition.options.presentation.label).toBe('Original');
  expect(Object.isFrozen(definition.options.tags)).toBe(true);
  expectTypeOf(definition.options.tags).toEqualTypeOf<readonly string[]>();

  function invalidMutation() {
    // @ts-expect-error Owned nested configuration cannot be mutated by a consumer.
    definition.options.presentation.label = 'Changed';
    // @ts-expect-error Owned option arrays are readonly.
    definition.options.tags.push('Changed');
  }

  void invalidMutation;
});

test('inline projections infer normalized attributes and receive configured options', () => {
  const token = defineInline(
    {
      name: 'token',
      version: 1,
      options: { prefix: '@' },
      schema: () => ({ attributes: z.strictObject({ label: z.string() }) }),
    },
    (attrs, options) => {
      expectTypeOf(attrs).toEqualTypeOf<{ readonly label: string }>();

      return options.prefix + attrs.label;
    },
  );

  const configured = token.configure({ prefix: '#' });
  expect(configured.spec.plainText({ label: 'tag' })).toBe('#tag');
  expect(token.spec.plainText({ label: 'tag' })).toBe('@tag');
  expect(() => configured.spec.plainText({ label: 4 })).toThrow(/string/);

  function invalidCanonicalValidators() {
    // @ts-expect-error Canonical node attributes must agree with normalized output.
    defineNode({
      name: 'bad',
      version: 1,
      options: {},
      schema: () => ({
        attributes: z.strictObject({ count: z.number() }),
        outputAttributes: z.strictObject({ count: z.string() }),
        content: { kind: 'atom' },
      }),
    });
    // @ts-expect-error Canonical mark attributes must agree with normalized output.
    defineMark({
      name: 'bad',
      version: 1,
      options: {},
      schema: () => ({ attributes: z.number(), outputAttributes: z.string() }),
    });
    defineInline(
      // @ts-expect-error Canonical inline attributes must agree with normalized output.
      {
        name: 'bad',
        version: 1,
        options: {},
        schema: () => ({ attributes: z.number(), outputAttributes: z.string() }),
      },
      () => '',
    );
  }

  void invalidCanonicalValidators;
});

test('inline projections infer option-dependent defaults and nested readonly output', () => {
  const config = {
    name: 'configuredToken',
    version: 1,
    options: { label: 'Default' },
    schema: (options: { readonly label: string }) => ({
      attributes: z.strictObject({
        label: z.string().default(options.label),
        aliases: z.array(z.string()).default([]),
      }),
    }),
  };

  const token = defineInline(config, (attrs, options) => {
    expectTypeOf(attrs).toEqualTypeOf<{
      readonly label: string;
      readonly aliases: readonly string[];
    }>();
    expectTypeOf(options).toEqualTypeOf<{ readonly label: string }>();

    function invalidMutation() {
      // @ts-expect-error Projection attributes remain deeply readonly.
      attrs.aliases.push('Changed');
      // @ts-expect-error Options remain readonly.
      options.label = 'Changed';
    }

    void invalidMutation;

    return `${attrs.label}:${attrs.aliases.join(',')}`;
  });

  expect(
    token
      .configure({ label: 'Configured' })
      .spec.plainText({ label: 'Canonical', aliases: ['one'] }),
  ).toBe('Canonical:one');

  function invalidProjection() {
    // @ts-expect-error Projection parameter annotations cannot override the schema's output.
    defineInline(config, (_attrs: { label: number }) => 'Invalid');
  }

  void invalidProjection;
});
