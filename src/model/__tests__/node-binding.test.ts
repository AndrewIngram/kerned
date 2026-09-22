import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createSchema, defineNode, defineMark, defineInline } from '../index';

const text = defineNode({
  name: 'text',
  version: 1,
  options: { max: 4 },
  schema: (options) => ({
    groups: ['block'],
    attributes: z.strictObject({
      value: z.string(),
      level: z.number().int().min(1).max(options.max),
    }),
    content: { kind: 'text', field: 'value', marks: 'styles', inline: 'objects' },
  }),
});

const group = defineNode({
  name: 'group',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ label: z.string().default('Group') }),
    content: { kind: 'container', field: 'body', allowedGroups: ['block'], minChildren: 1 },
  }),
});

const schema = createSchema({ extensions: [text.configure({ max: 2 }), group] });

test('bindings use the installed configuration and preserve inferred attribute types', () => {
  const type = schema.node(text);
  const node = type.create({ id: 1, key: 'text-1' }, { value: 'Heading', level: 2 });
  expect(type.name).toBe('text');
  expectTypeOf(type.name).toEqualTypeOf<'text'>();
  expectTypeOf(type.read(node)).toEqualTypeOf<{
    readonly value: string;
    readonly level: number;
  } | null>();
  expect(type.read(node)).toEqual({ value: 'Heading', level: 2 });
  expect(type.read(node)).toBe(type.read(node));
  expect(schema.isNode(node, text)).toBe(true);
  expect(schema.isNode(node, group)).toBe(false);
  expect(node).toMatchObject({ styles: [], objects: [] });
  expect(() => type.create({ id: 2, key: 'text-2' }, { value: 'Too deep', level: 3 })).toThrow(
    /<=2/,
  );
  expect(() => type.create({ id: NaN, key: 'bad' }, { value: '', level: 1 })).toThrow(/number/);
  expect(() => type.create({ id: 2, key: '' }, { value: '', level: 1 })).toThrow(/>=1/);

  function invalidArguments() {
    // @ts-expect-error Attributes come from the requested definition's Standard Schema.
    type.create({ id: 1, key: 'id' }, { value: 42, level: 1 });
    // @ts-expect-error Required attribute fields remain required.
    type.create({ id: 1, key: 'id' }, { value: 'Missing level' });
  }

  void invalidArguments;
});

test('containers own their supplied child sequence and retain canonical child values', () => {
  const child = schema.node(text).create({ id: 1, key: 'text-1' }, { value: 'Text', level: 1 });
  const children = [child];
  const node = schema.node(group).create({ id: 2, key: 'group-2' }, {}, children);
  children.length = 0;
  expect(schema.children(node)).toEqual([child]);
  expect(schema.children(node)[0]).toBe(child);
  expect(schema.node(group).read(node)).toMatchObject({ label: 'Group' });
  expect(schema.node(text).read(node)).toBeNull();
  expect(schema.validateDocument([node]).issues).toBeUndefined();
  expect(() =>
    schema.node(text).create({ id: 3, key: 'text-3' }, { value: '', level: 1 }, [child]),
  ).toThrow(/containers/);
});

test('bindings reject uninstalled or unrelated definitions with the same name', () => {
  const imposter = defineNode({
    name: 'text',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ other: z.string() }),
      content: { kind: 'atom' },
    }),
  });

  const missing = defineNode({
    name: 'missing',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.strictObject({}), content: { kind: 'atom' } }),
  });

  expect(() => schema.node(imposter)).toThrow(/Different node definition/);
  expect(() => schema.node(missing)).toThrow(/No node factory/);
  const node = schema.node(text).create({ id: 1, key: 'text-1' }, { value: 'Text', level: 1 });
  expect(schema.isNode(node, missing)).toBe(false);
  expect(schema.isNode(node, imposter)).toBe(false);
});

test('construction normalizes once, owns attributes, and reads without revalidating', () => {
  let parses = 0;

  const counter = defineNode({
    name: 'counter',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z
        .strictObject({ count: z.number(), labels: z.array(z.string()) })
        .transform((attrs) => {
          parses++;

          return { ...attrs, count: attrs.count + 1 };
        }),
      outputAttributes: z.strictObject({ count: z.number(), labels: z.array(z.string()) }),
      content: { kind: 'atom' },
    }),
  });

  const compiled = createSchema({ extensions: [counter] });
  const type = compiled.node(counter);
  const input = { count: 1, labels: ['one'] };
  const node = type.create({ id: 1, key: 'counter' }, input);
  input.labels.push('external');
  expect(type.read(node)).toMatchObject({ count: 2, labels: ['one'] });
  expect(type.read(node)).toMatchObject({ count: 2 });
  expect(compiled.validateDocument([node]).issues).toBeUndefined();
  const copied = compiled.copy(node, () => ({ id: 2, key: 'copy' }));
  expect(type.read(copied)).toEqual(type.read(node));
  expect(copied).toMatchObject({ id: 2, key: 'copy' });
  expect(parses).toBe(1);
  expect(Object.isFrozen(type.read(node)?.labels)).toBe(true);
});

test('copying a subtree respects custom storage and renews node and inline identities', () => {
  const style = defineMark({
    name: 'style',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.null() }),
  });

  const reference = defineInline(
    {
      name: 'reference',
      version: 1,
      options: {},
      schema: () => ({ attributes: z.strictObject({ label: z.string() }) }),
    },
    (attrs) => attrs.label,
  );

  const compiled = createSchema({ extensions: [text, group, style, reference] });

  const parsed = compiled['~standard'].validate([
    {
      kind: 'group',
      id: 1,
      key: 'group',
      body: [
        {
          kind: 'text',
          id: 2,
          key: 'text',
          locked: true,
          value: 'Hi \ufffc',
          level: 1,
          styles: [{ from: 0, to: 4, mark: { type: 'style', attrs: null } }],
          objects: [
            { id: 'original-inline', index: 3, type: 'reference', attrs: { label: 'Ada' } },
          ],
        },
      ],
    },
  ]);

  if (parsed.issues) throw new Error('Invalid test document');
  const source = parsed.value[0];
  let id = 10;
  const clone = compiled.copy(source, () => ({ id: id++, key: `copy-${id}` }));
  const child = compiled.children(clone)[0];
  expect(clone.key).not.toBe(source.key);
  expect(child).toMatchObject({
    kind: 'text',
    locked: true,
    value: 'Hi \ufffc',
    styles: [{ mark: { type: 'style' } }],
    objects: [{ index: 3, attrs: { label: 'Ada' } }],
  });

  if (child.kind !== 'text') throw new Error('Expected text');
  expect(child.objects[0].id).not.toBe('original-inline');
  expect(compiled.validateDocument([source, clone]).issues).toBeUndefined();
  expect(compiled.children(source)[0].key).toBe('text');
});

test('rich text construction validates canonical values and owns their ranges and attributes', () => {
  const link = defineMark({
    name: 'link',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.strictObject({ href: z.string() }) }),
  });

  const token = defineInline(
    {
      name: 'token',
      version: 1,
      options: {},
      schema: () => ({ attributes: z.strictObject({ label: z.string() }) }),
    },
    (attrs) => attrs.label,
  );

  const compiled = createSchema({ extensions: [text, link, token] });
  const ranges = [{ from: 0, to: 4, mark: { type: 'link', attrs: { href: '/one' } } }];
  const objects = [{ ...compiled.value(token).create({ label: 'Ada' }), id: 'token-1', index: 3 }];

  const node = compiled
    .node(text)
    .create(
      { id: 1, key: 'rich' },
      { value: 'Hi \ufffc', level: 1 },
      { marks: ranges, inline: objects },
    );

  ranges[0].mark.attrs.href = '/changed';
  ranges[0].from = 2;
  objects.length = 0;
  expect(compiled.editing(node).marks?.read(node)).toEqual([
    { from: 0, to: 4, mark: { type: 'link', attrs: { href: '/one' } } },
  ]);
  expect(compiled.editing(node).inline?.read(node)).toMatchObject([
    { id: 'token-1', index: 3, attrs: { label: 'Ada' } },
  ]);
  expect(compiled.validateDocument([node]).issues).toBeUndefined();
  expect(Object.isFrozen(compiled.editing(node).marks?.read(node)[0].mark.attrs)).toBe(true);
  expect(() =>
    compiled.node(text).create({ id: 2, key: 'bad' }, { value: '\ufffc', level: 1 }),
  ).toThrow(/Missing inline object/);
  expect(() =>
    compiled.node(text).create(
      { id: 2, key: 'bad' },
      { value: 'abc', level: 1 },
      {
        marks: [{ from: 0, to: 4, mark: compiled.value(link).create({ href: '/one' }) }],
      },
    ),
  ).toThrow(/range/i);
});
