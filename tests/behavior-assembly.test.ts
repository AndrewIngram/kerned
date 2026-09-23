import { createSchema, defineExtension, defineNode, type DocumentNode } from '@kerned/model';
import { createEditor, createStateField, textSelection } from '@kerned/state';
import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

const line = defineNode({
  name: 'line',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

type Line = DocumentNode<readonly [typeof line]>;

const counter = defineExtension({
  name: 'counter',
  requires: ['line'],
  options: { initial: 0 },
  setup: ({ initial }) => ({
    count: createStateField<Line, number>({
      create: () => initial,
      update: (value, event) => (event.kind === 'transaction' ? value + 1 : value),
    }),
  }),
});

test('assembled behavior creates independent state for each session without entering content', () => {
  const schema = createSchema({ extensions: [line, counter.configure({ initial: 4 })] });
  expectTypeOf(schema.definitions[1].name).toEqualTypeOf<'counter'>();
  expectTypeOf<DocumentNode<typeof schema.definitions>['kind']>().toEqualTypeOf<'line'>();
  expect(schema.manifest).toEqual([{ name: 'line', version: 1 }]);

  const first = schema.definitions[1].setup();
  const second = schema.definitions[1].setup();
  expect(first.count).not.toBe(second.count);
  const content: Line[] = [{ kind: 'line', id: 1, key: 'line', text: 'Hello' }];
  const a = createEditor(schema, content, textSelection(1, 0), [], { fields: [first.count] });
  const b = createEditor(schema, content, textSelection(1, 0), [], { fields: [second.count] });
  expect(first.count.read(a.state)).toBe(4);
  expect(second.count.read(b.state)).toBe(4);
  expect(() => first.count.read(b.state)).toThrow(/not registered/);
  a.dispatch({
    baseRevision: 0,
    origin: 'local',
    history: 'separate',
    time: 0,
    steps: [{ kind: 'replaceText', id: 1, from: 0, to: 0, text: '!' }],
  });
  expect(first.count.read(a.state)).toBe(5);
  expect(second.count.read(b.state)).toBe(4);
  expect(counter.options.initial).toBe(0);
});

test('behavior dependencies and names are checked without executing session setup', () => {
  let calls = 0;

  const behavior = defineExtension({
    name: 'watcher',
    options: {},
    requires: ['line'],
    setup: () => {
      calls++;

      return {};
    },
  });

  const schema = createSchema({ extensions: [line, behavior] });
  expect(calls).toBe(0);
  const invalidContent = schema['~standard'].validate([{ kind: 'watcher' }]);
  expect(invalidContent.issues?.[0].path).toEqual([0, 'kind']);
  expect(() => {
    createSchema({ extensions: [behavior] });
  }).toThrow(/Missing dependency line/);
  expect(() => {
    createSchema({ extensions: [line, behavior, behavior] });
  }).toThrow(/Duplicate extension/);
  expect(() => {
    createSchema({
      extensions: [line, defineExtension({ name: 'line', options: {}, setup: () => ({}) })],
    });
  }).toThrow(/Duplicate extension/);
  schema.definitions[1].setup();
  expect(calls).toBe(1);
});
