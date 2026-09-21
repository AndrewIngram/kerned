import { expect, test } from 'vitest';
import { z } from 'zod';

import {
  createSchema,
  defineNode,
  defineMark,
  defineInline,
  validateTree,
  createDocumentCodec,
} from '../src/model';
import { createEditor, textSelection } from '../src/state';
import { applySteps, restoreChanges } from '../src/transform';

const emphasis = defineMark({
  name: 'emphasis',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.null() }),
});

const line = defineNode({
  name: 'line',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ value: z.string(), priority: z.number().int().default(0) }),
    content: { kind: 'text', field: 'value', marks: 'formatting', allowedMarks: ['emphasis'] },
  }),
});

const title = defineNode({
  name: 'title',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ label: z.string(), level: z.literal(1) }),
    content: { kind: 'text', field: 'label', marks: 'formatting', emptySplit: 'line' },
  }),
});

const section = defineNode({
  name: 'section',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({}),
    content: {
      kind: 'container',
      field: 'items',
      allowed: ['line', 'title', 'section'],
      minChildren: 1,
    },
  }),
});

const schema = createSchema({ extensions: [line, title, section, emphasis] });

function read(input: Parameters<(typeof schema)['~standard']['validate']>[0]) {
  const result = schema['~standard'].validate(input);

  if (result.issues) throw new Error(JSON.stringify(result.issues));

  return result.value;
}

test('a definition-derived schema edits custom text storage inside custom containers', () => {
  const initial = read([
    {
      kind: 'section',
      id: 10,
      key: 'section',
      items: [
        {
          kind: 'line',
          id: 1,
          key: 'first',
          value: 'Hello world',
          formatting: [{ from: 0, to: 5, mark: { type: 'emphasis', attrs: null } }],
        },
      ],
    },
  ]);

  const result = applySteps(
    schema,
    [...initial],
    [
      { kind: 'split', id: 1, at: 5, rightId: 2, rightKey: 'second' },
      { kind: 'replaceText', id: 2, from: 0, to: 1, text: ', ' },
      { kind: 'join', left: 1, right: 2 },
    ],
  );

  const parent = result.nodes[0];

  if (parent.kind !== 'section') throw new Error('Expected section');
  expect(parent.items[0]).toMatchObject({
    value: 'Hello, world',
    formatting: [{ from: 0, to: 5, mark: { type: 'emphasis', attrs: null } }],
  });
  expect(restoreChanges(result.nodes, result.changes, 'backward').nodes).toEqual(initial);
  expect(initial[0]).not.toBe(parent);
});

test('empty title splits use target defaults and preserve identity and locking', () => {
  const initial = read([
    { kind: 'title', id: 1, key: 'title', locked: true, label: 'Title', level: 1 },
  ]);

  const result = applySteps(
    schema,
    [...initial],
    [{ kind: 'split', id: 1, at: 5, rightId: 2, rightKey: 'next' }],
  );

  expect(result.nodes[1]).toEqual({
    kind: 'line',
    id: 2,
    key: 'next',
    locked: true,
    value: '',
    priority: 0,
    formatting: [],
  });
});

test('assembled schemas participate in session history and retained positions', () => {
  const initial = read([{ kind: 'line', id: 1, key: 'one', value: 'Hello' }]);
  const editor = createEditor(schema, [...initial], textSelection(1, 2));
  const position = editor.positions.at(1, 4, 1);
  editor.dispatch({
    baseRevision: 0,
    origin: 'local',
    history: 'separate',
    time: 1,
    steps: [{ kind: 'replaceText', id: 1, from: 2, to: 2, text: '!' }],
  });
  expect(schema.text(editor.state.nodes[0])).toBe('He!llo');
  expect(editor.positions.resolve(position)).toMatchObject({
    status: 'resolved',
    point: { id: 1, offset: 5 },
  });
  editor.undo();
  expect(editor.state.nodes).toEqual(initial);
  editor.redo();
  expect(schema.text(editor.state.nodes[0])).toBe('He!llo');
});

test('ordinary typing never revalidates the document or unrelated node attributes', () => {
  let attributeValidations = 0;

  const counted = defineNode({
    name: 'counted',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ value: z.string() }).superRefine(() => {
        attributeValidations++;
      }),
      content: { kind: 'text', field: 'value' },
    }),
  });

  const assembled = createSchema({ extensions: [counted] });

  const result = assembled['~standard'].validate(
    Array.from({ length: 2000 }, (_, index) => ({
      kind: 'counted',
      id: index + 1,
      key: `key-${index}`,
      value: 'Text',
    })),
  );

  if (result.issues) throw new Error(JSON.stringify(result.issues));
  // Import normalizes and then proves the output is canonical; edits still validate only one node.
  expect(attributeValidations).toBe(4000);
  attributeValidations = 0;

  const edited = applySteps(
    assembled,
    [...result.value],
    [{ kind: 'replaceText', id: 1000, from: 2, to: 2, text: '!' }],
  );

  expect(edited.nodes[999].value).toBe('Te!xt');
  expect(edited.nodes[0]).toBe(result.value[0]);
  expect(attributeValidations).toBe(1);
});

test('grouped child storage validates row membership and preserves child order', () => {
  const cell = defineNode({
    name: 'cell',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ row: z.number().int().nonnegative() }),
      content: { kind: 'atom' },
    }),
  });

  const grid = defineNode({
    name: 'grid',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({}),
      content: {
        kind: 'container',
        field: 'rows',
        depth: 2,
        groupBy: 'row',
        allowed: ['cell'],
        minChildren: 1,
      },
    }),
  });

  const assembled = createSchema({ extensions: [grid, cell] });

  const result = assembled['~standard'].validate([
    { kind: 'grid', rows: [[{ kind: 'cell', row: 0 }], [{ kind: 'cell', row: 1 }]] },
  ]);

  if (result.issues) throw new Error(JSON.stringify(result.issues));
  const parent = result.value[0];
  const children = assembled.children(parent);
  expect(assembled.withChildren(parent, [...children])).toEqual(parent);
  expect(assembled.children(parent)).toHaveLength(2);
  expect(() => validateTree(assembled, result.value)).not.toThrow();
  expect(
    assembled['~standard'].validate([{ kind: 'grid', rows: [[{ kind: 'cell', row: 1 }]] }])
      .issues?.[0].path,
  ).toEqual([0, 'rows', 0, 0, 'row']);
});

test('configured restrictions reject edits atomically and do not silently normalize mapped text', () => {
  const limited = line.configure({});

  const short = defineNode({
    name: 'short',
    version: 1,
    options: { max: 3 },
    schema: (options) => ({
      attributes: z.strictObject({ value: z.string().max(options.max) }),
      content: { kind: 'text', field: 'value' },
    }),
  });

  const normalizing = defineNode({
    name: 'normalizing',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ value: z.string().trim() }),
      content: { kind: 'text', field: 'value' },
    }),
  });

  const assembled = createSchema({ extensions: [short, normalizing, limited, emphasis] });

  const parsed = assembled['~standard'].validate([
    { kind: 'short', id: 1, key: 'short', value: 'abc' },
    { kind: 'normalizing', id: 2, key: 'trimmed', value: ' text ' },
  ]);

  if (parsed.issues) throw new Error(JSON.stringify(parsed.issues));
  expect(assembled.text(parsed.value[1])).toBe('text');
  expect(() => {
    applySteps(
      assembled,
      [...parsed.value],
      [{ kind: 'replaceText', id: 1, from: 3, to: 3, text: 'd' }],
    );
  }).toThrow(/Too big/);
  expect(() => {
    applySteps(
      assembled,
      [...parsed.value],
      [{ kind: 'replaceText', id: 2, from: 0, to: 0, text: ' ' }],
    );
  }).toThrow(/position mappings/);
  expect(assembled.text(parsed.value[0])).toBe('abc');
});

test('derived codecs reject unknown node, mark and inline versions', () => {
  const codec = createDocumentCodec(schema);

  const initial = read([
    {
      kind: 'line',
      id: 1,
      key: 'line',
      value: 'Hi',
      formatting: [{ from: 0, to: 2, mark: { type: 'emphasis', attrs: null } }],
    },
  ]);

  const encoded = codec.encode(initial);
  expect(codec.decode(encoded)).toEqual(initial);

  const versioned = {
    version: 1,
    nodes: [
      {
        type: 'line',
        version: 1,
        id: 1,
        key: 'line',
        children: [],
        data: {
          value: 'Hi',
          priority: 0,
          formatting: [{ from: 0, to: 2, mark: { type: 'emphasis', attrs: null, version: 99 } }],
        },
      },
    ],
  };

  expect(() => codec.decode(versioned)).toThrow(/Unsupported mark version/);
  expect(() =>
    codec.decode({ version: 1, nodes: [{ ...versioned.nodes[0], version: 99 }] }),
  ).toThrow(/Unsupported line version/);

  const token = defineInline(
    {
      name: 'token',
      version: 1,
      options: {},
      schema: () => ({ attributes: z.null() }),
    },
    () => 'Token',
  );

  const rich = defineNode({
    name: 'rich',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ text: z.string() }),
      content: { kind: 'text', field: 'text', inline: 'inline' },
    }),
  });

  const richCodec = createDocumentCodec(createSchema({ extensions: [token, rich] }));
  expect(() =>
    richCodec.decode({
      version: 1,
      nodes: [
        {
          type: 'rich',
          version: 1,
          id: 1,
          key: 'rich',
          children: [],
          data: {
            text: '\ufffc',
            inline: [{ type: 'token', version: 99, id: 'token', index: 0, attrs: null }],
          },
        },
      ],
    }),
  ).toThrow(/Unsupported inline version/);
});
