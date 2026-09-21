import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import type { StarterNode } from '../../extensions/demo-model';
import { demoSchema } from '../../extensions/demo-schema';
import { localHistory } from '../../extensions/history';
import { tableCells } from '../../extensions/table';
import {
  createSchema,
  defineNode,
  defineMark,
  defineInline,
  indexTree,
  type DocumentNode,
  type NodeIdentity,
} from '../../model';
import { createStateField, textSelection } from '../../state';
import {
  createEditor,
  defineExtension,
  selectedValue,
  type CommandDefinition,
  type CommandContext,
  type ReadContext,
} from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

type Note = DocumentNode<readonly [typeof note]>;

const append: CommandDefinition<Note, [string]> = {
  activity: ({ state }, text) => (state.nodes[0].text.endsWith(text) ? 'active' : 'inactive'),
  execute(context, text) {
    const node = context.state.nodes[0];
    context.step({
      kind: 'replaceText',
      id: node.id,
      from: node.text.length,
      to: node.text.length,
      text,
    });

    return true;
  },
};

const editing = defineExtension({
  name: 'editing',
  requires: ['note'],
  options: { suffix: '?' },
  setup: (options) => ({
    queries: {
      textLengths: ({ state }: { state: { nodes: readonly Note[] } }) =>
        selectedValue(state.nodes.map((node) => node.text.length)),
    },
    commands: {
      append,
      appendSuffix: {
        execute(context) {
          return context.command(append, options.suffix);
        },
      } satisfies CommandDefinition<Note>,
      unavailable: { execute: () => false } satisfies CommandDefinition<Note>,
    },
  }),
});

const schema = createSchema({ extensions: [note, editing, localHistory] });

function session() {
  return createEditor({ schema, content: [{ kind: 'note', text: 'A' }] });
}

test('public named chains accept history options without changing dry-run state', () => {
  const editor = session();
  const options = { history: { group: 'typing:note' }, time: 100 };
  expect(editor.chain(options).append('B').run()).toBe(true);
  const before = editor.state;
  expect(
    editor
      .can()
      .chain({ ...options, time: 200 })
      .append('C')
      .run(),
  ).toBe(true);
  expect(editor.state).toBe(before);
  expect(
    editor
      .chain({ ...options, time: 200 })
      .append('C')
      .run(),
  ).toBe(true);
  expect(editor.history.undo).toBe(1);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('A');
});

test('input edits support unformatted text and reject unsupported explicit marks atomically', () => {
  const editor = session();
  const node = editor.state.nodes[0];
  editor.select(textSelection(node.id, 1));
  expect(
    editor.transact((context) => {
      context.apply({
        input: true,
        steps: [{ kind: 'replaceText', id: node.id, from: 1, to: 1, text: 'B' }],
        selection: textSelection(node.id, 2),
      });

      return true;
    }),
  ).toBe(true);
  expect(editor.state.nodes[0].text).toBe('AB');
  expect(editor.state.storedMarks).toBeNull();
  const before = editor.state;
  expect(() =>
    editor.transact((context) => {
      context.apply({
        input: true,
        steps: [
          {
            kind: 'replaceText',
            id: node.id,
            from: 2,
            to: 2,
            text: 'C',
            marks: [{ type: 'bold', attrs: null }],
          },
        ],
        selection: textSelection(node.id, 3),
      });

      return true;
    }),
  ).toThrow(/does not support marks/);
  expect(editor.state).toBe(before);
});

test('one assembly supplies content, named commands, chains and dry runs with inferred arguments', () => {
  const editor = session();
  const initial = editor.state;
  expectTypeOf(editor.commands.append).parameters.toEqualTypeOf<[string]>();
  expectTypeOf(editor.state.nodes[0].kind).toEqualTypeOf<'note'>();
  expect(editor.can().append('!')).toBe(true);
  expect(editor.can().chain().append('!').appendSuffix().run()).toBe(true);
  expect(editor.state).toBe(initial);
  expect(editor.chain().append('!').appendSuffix().run()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('A!?');
  expect(editor.history.undo).toBe(1);
  editor.commands.undo();
  expect(editor.state.nodes[0].text).toBe('A');
  expect(editor.commands.append('B')).toBe(true);
  expect(editor.state.nodes[0].text).toBe('AB');

  function invalidCommands() {
    // @ts-expect-error Installed command arguments are inferred without global augmentation.
    editor.commands.append(1);
    // @ts-expect-error Uninstalled capabilities are not exposed.
    editor.commands.toggleTable();
    // @ts-expect-error Content is inferred from the same schema.
    createEditor({ schema, content: [{ kind: 'paragraph', text: 'Missing extension' }] });

    const foreign = defineNode({
      name: 'card',
      version: 1,
      options: {},
      schema: () => ({
        attributes: z.strictObject({ title: z.string() }),
        content: { kind: 'atom' },
      }),
    });

    const mixed = createSchema({ extensions: [note, foreign, editing] });
    // @ts-expect-error A closed Note command cannot assume every node in an open document is a Note.
    createEditor({ schema: mixed, content: [{ kind: 'card', title: 'Foreign node' }] });
  }

  void invalidCommands;
});

test('captured callbacks read current session state and failed named chains roll back', () => {
  const editor = session();
  const appendLater = editor.commands.append;
  editor.commands.append('first');
  appendLater('second');
  expect(editor.state.nodes[0].text).toBe('Afirstsecond');
  const initial = editor.state;
  expect(editor.chain().append('discard').unavailable().run()).toBe(false);
  expect(editor.state).toBe(initial);
});

test('sessions instantiate fresh fields from shared configured extension definitions', () => {
  const fields: ReturnType<typeof createStateField<Note, number>>[] = [];

  const counter = defineExtension({
    name: 'counter',
    options: {},
    setup() {
      const field = createStateField<Note, number>({
        create: () => 0,
        update: (value) => value + 1,
      });

      fields.push(field);

      return { fields: [field] };
    },
  });

  const shared = createSchema({ extensions: [note, editing.configure({ suffix: '!' }), counter] });
  const first = createEditor({ schema: shared, content: [{ kind: 'note', text: 'First' }] });
  const second = createEditor({ schema: shared, content: [{ kind: 'note', text: 'Second' }] });
  first.commands.appendSuffix();
  expect(first.state.nodes[0].text).toBe('First!');
  expect(second.state.nodes[0].text).toBe('Second');
  expect(fields[0]).not.toBe(fields[1]);
  expect(fields[0].read(first.state)).toBe(1);
  expect(fields[1].read(second.state)).toBe(0);
  expect(() => fields[0].read(second.state)).toThrow(/not registered/);
});

test('command collisions identify both owning extensions and reserved methods cannot be replaced', () => {
  const conflict = defineExtension({
    name: 'other',
    options: {},
    setup: () => ({ commands: { append } }),
  });

  const duplicate = createSchema({ extensions: [note, editing, conflict] });
  expect(() => createEditor({ schema: duplicate, content: [] })).toThrow(
    /Duplicate command append: editing and other/,
  );

  const reserved = defineExtension({
    name: 'bad',
    options: {},
    setup: () => ({ commands: { run: append } }),
  });

  expect(() =>
    createEditor({ schema: createSchema({ extensions: [note, reserved] }), content: [] }),
  ).toThrow(/Reserved command name: run/);
});

test('construction validates content and selection before accepting edits', () => {
  const editor = session();
  expect(() =>
    createEditor({
      schema,
      content: [{ kind: 'note', text: 'A' }],
      selection: textSelection(999, 0),
    }),
  ).toThrow(/Missing|endpoint/);
  expect(editor.state.nodes[0].key).toBeTruthy();
  expect(editor.state.nodes[0].id).toBeTypeOf('number');
});

test('availability, activity and selected values are separate live queries', () => {
  const editor = session();
  expect(editor.getCommandState('append', '!')).toEqual({ available: true, activity: 'inactive' });
  expect(editor.queries.textLengths()).toEqual({ kind: 'uniform', value: 1 });
  editor.commands.append('!');
  expect(editor.getCommandState('append', '!')).toEqual({ available: true, activity: 'active' });
  expect(editor.getCommandState('unavailable')).toEqual({ available: false, activity: 'inactive' });
  expect(editor.queries.textLengths()).toEqual({ kind: 'uniform', value: 2 });
  expect(selectedValue([])).toEqual({ kind: 'none' });
  expect(selectedValue([1, 2])).toEqual({ kind: 'mixed' });
  expect(selectedValue([{ level: 1 }, { level: 1 }], (a, b) => a.level === b.level)).toEqual({
    kind: 'uniform',
    value: { level: 1 },
  });

  function invalidQueries() {
    // @ts-expect-error Activity uses the installed command's arguments.
    editor.getCommandState('append', 1);
    // @ts-expect-error Queries are inferred from installed extensions.
    editor.queries.uninstalled();

    const invalid = defineExtension({
      name: 'invalid',
      options: {},
      setup: () => ({ commands: { broken: 3 } }),
    });

    // @ts-expect-error Model can retain behavior but the session rejects invalid command contributions.
    createEditor({ schema: createSchema({ extensions: [note, invalid] }), content: [] });
  }

  void invalidQueries;
});

test('the complete recursive starter schema retains typed commands and table selections', () => {
  const insert: CommandDefinition<StarterNode, [number, string]> = {
    execute(context, id, text) {
      const node = indexTree(demoSchema, context.state.nodes).byId.get(id)?.node;

      if (!node || (node.kind !== 'paragraph' && node.kind !== 'heading')) return false;
      context.step({ kind: 'replaceText', id, from: 0, to: 0, text });

      return true;
    },
  };

  const behavior = defineExtension({
    name: 'nestedEditing',
    options: {},
    requires: ['table'],
    setup: () => ({ commands: { insert }, selections: [tableCells.extension] }),
  });

  const combined = createSchema({
    extensions: [...demoSchema.definitions, behavior, localHistory],
  });

  const editor = createEditor({
    schema: combined,
    content: [
      {
        kind: 'quote',
        children: [
          {
            kind: 'table',
            caption: '',
            rows: [
              [
                {
                  kind: 'tableCell',
                  row: 0,
                  header: false,
                  colspan: 1,
                  rowspan: 1,
                  paragraphs: [{ kind: 'paragraph', id: 50, text: 'Nested' }],
                },
              ],
            ],
          },
        ],
      },
    ],
  });

  expectTypeOf(editor.commands.insert).parameters.toEqualTypeOf<[number, string]>();
  expect(editor.commands.insert(50, 'Deep ')).toBe(true);
  expect(indexTree(demoSchema, editor.state.nodes).byId.get(50)?.node).toMatchObject({
    text: 'Deep Nested',
  });
  editor.commands.undo();
  expect(indexTree(demoSchema, editor.state.nodes).byId.get(50)?.node).toMatchObject({
    text: 'Nested',
  });
});

test('canonical documents retain normalized attributes and identities when opening a session', () => {
  const counted = defineNode({
    name: 'counted',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({
        text: z.string(),
        count: z.number().transform((value) => value + 1),
      }),
      outputAttributes: z.strictObject({ text: z.string(), count: z.number() }),
      content: { kind: 'text', field: 'text' },
    }),
  });

  const countedSchema = createSchema({ extensions: [counted] });
  const parsed = countedSchema['~standard'].validate([{ kind: 'counted', text: 'A', count: 1 }]);

  if (parsed.issues) throw new Error('Expected valid input');
  expect(parsed.value[0].count).toBe(2);
  const editor = createEditor({ schema: countedSchema, document: parsed.value });
  expect(editor.state.nodes[0]).toEqual(parsed.value[0]);
  expect(editor.state.nodes[0].count).toBe(2);
  expect(editor.state.nodes[0]).not.toBe(parsed.value[0]);
  expect(
    countedSchema.validateDocument([{ kind: 'counted', text: 'A', count: 2 }]).issues,
  ).toBeDefined();
  expect(
    countedSchema.validateDocument([{ ...parsed.value[0], count: 'bad' }]).issues,
  ).toBeDefined();
});

test('node, mark and inline definitions own typed contributions through configuration', () => {
  const contributedNote = defineNode({
    name: 'note',
    version: 1,
    options: { suffix: '!' },
    schema: () => ({
      attributes: z.strictObject({ text: z.string() }),
      content: { kind: 'text', field: 'text', marks: 'marks', inline: 'inline' },
    }),
    setup(options) {
      const edits = createStateField<NodeIdentity, number>({
        create: () => 0,
        update: (value, event) => value + (event.kind === 'transaction' ? 1 : 0),
      });

      return {
        fields: [edits],
        queries: {
          edits<N extends NodeIdentity>({ state }: ReadContext<N>) {
            return edits.read(state);
          },
        },
        commands: {
          appendSuffix: {
            execute<N extends NodeIdentity>(context: CommandContext<N>) {
              const node = context.state.nodes[0];
              const text = context.schema.text(node);

              if (text === null) return false;
              context.step({
                kind: 'replaceText',
                id: node.id,
                from: text.length,
                to: text.length,
                text: options.suffix,
              });

              return true;
            },
          },
        },
      };
    },
  }).configure({ suffix: '?' });

  const emphasis = defineMark({
    name: 'emphasis',
    version: 1,
    options: { label: 'Emphasis' },
    schema: () => ({ attributes: z.null() }),
    setup: (options) => ({ queries: { emphasisLabel: () => options.label } }),
  }).configure({ label: 'Strong' });

  const mention = defineInline(
    {
      name: 'mention',
      version: 1,
      options: { prefix: '@' },
      schema: () => ({ attributes: z.string() }),
      setup: (options) => ({ queries: { mentionPrefix: () => options.prefix } }),
    },
    (name, options) => options.prefix + name,
  ).configure({ prefix: '#' });

  const assembled = createSchema({ extensions: [contributedNote, emphasis, mention] });
  const first = createEditor({ schema: assembled, content: [{ kind: 'note', text: 'First' }] });
  const second = createEditor({ schema: assembled, content: [{ kind: 'note', text: 'Second' }] });
  expectTypeOf(first.commands.appendSuffix).parameters.toEqualTypeOf<[]>();
  expectTypeOf(first.queries.edits()).toEqualTypeOf<number>();
  expect(first.commands.appendSuffix()).toBe(true);
  expect(first.state.nodes[0].text).toBe('First?');
  expect(first.queries.edits()).toBe(1);
  expect(second.queries.edits()).toBe(0);
  expect(first.queries.emphasisLabel()).toBe('Strong');
  expect(first.queries.mentionPrefix()).toBe('#');
});

test('typed events separate persistence from selection and publish before view invalidation', () => {
  const editor = session();
  const node = editor.state.nodes[0];
  const observed: string[] = [];
  editor.on('update', (event) => {
    expect(editor.state).toBe(event.after);
    expect(() => editor.destroy()).toThrow(/during publication/);
    expect(editor.getCommandState('append', '!').available).toBe(true);
    expect(editor.can().append('!')).toBe(true);
    observed.push(`update:${event.kind}`);
  });
  editor.on('transaction', (event) => {
    expect(event.mapping.after).toBe(editor.state);
    observed.push(`transaction:${event.kind}`);
  });
  editor.on('content', (event) => observed.push(`content:${event.kind}`));
  editor.on('selection', () => observed.push('selection'));
  editor.subscribe(() => observed.push('view'));
  editor.select(textSelection(node.id, 1));
  expect(observed).toEqual(['update:selection', 'selection', 'view']);
  observed.length = 0;
  editor.select(textSelection(node.id, 1));
  expect(observed).toEqual(['update:selection', 'view']);
  observed.length = 0;
  editor.commands.append('B');
  expect(observed).toEqual([
    'update:transaction',
    'transaction:transaction',
    'content:transaction',
    'selection',
    'view',
  ]);
  observed.length = 0;
  editor.commands.undo();
  expect(observed).toEqual([
    'update:undo',
    'transaction:undo',
    'content:undo',
    'selection',
    'view',
  ]);
  observed.length = 0;
  editor.commands.redo();
  expect(observed).toEqual([
    'update:redo',
    'transaction:redo',
    'content:redo',
    'selection',
    'view',
  ]);
  observed.length = 0;
  editor.dispatch({
    baseRevision: editor.state.revision,
    origin: 'local',
    history: 'separate',
    time: 100,
    steps: [],
    selection: textSelection(node.id, 0),
  });
  expect(observed).toEqual(['update:transaction', 'transaction:transaction', 'selection', 'view']);
});

test('content listeners are snapshotted with all other channels, and dry runs publish nothing', () => {
  const editor = session();
  const observed: string[] = [];
  const stopContent = editor.on('content', () => observed.push('existing'));

  const stopUpdate = editor.on('update', () => {
    stopContent();
    editor.on('content', () => observed.push('new'));
  });

  const stopView = editor.subscribe(() => observed.push('view'));
  expect(editor.can().append('B')).toBe(true);
  expect(observed).toEqual([]);
  editor.commands.append('B');
  expect(observed).toEqual(['existing', 'view']);
  stopUpdate();
  stopUpdate();
  stopView();
  observed.length = 0;
  editor.commands.append('C');
  expect(observed).toEqual(['new']);
});

test('destroy is terminal and idempotent, retaining a readable final snapshot', () => {
  const editor = session();
  const other = session();
  editor.commands.append('B');
  const final = editor.state;
  const staleCommand = editor.commands.append;
  const pending = editor.chain().append('discard');
  const pendingDryRun = editor.can().chain().append('discard');
  const observed: string[] = [];
  const stopView = editor.subscribe(() => observed.push('view'));
  editor.on('content', () => observed.push('content'));
  editor.on('destroy', ({ state }) => {
    expect(state).toBe(final);
    expect(editor.isDestroyed).toBe(true);
    expect(() => editor.select(state.selection)).toThrow(/destroyed/);
    editor.destroy();
    observed.push('destroy');
  });
  editor.destroy();
  editor.destroy();
  stopView();
  stopView();
  expect(observed).toEqual(['destroy']);
  expect(editor.state).toBe(final);
  expect(editor.queries.textLengths()).toEqual({ kind: 'uniform', value: 2 });
  expect(editor.history).toEqual({ undo: 0, redo: 0 });
  expect(() => staleCommand('C')).toThrow(/destroyed/);
  expect(() => pending.run()).toThrow(/destroyed/);
  expect(() => pendingDryRun.run()).toThrow(/destroyed/);
  expect(() => editor.transact(() => true)).toThrow(/destroyed/);
  expect(() => editor.can().append('C')).toThrow(/destroyed/);
  expect(() => editor.commands.undo()).toThrow(/destroyed/);
  expect(() => editor.commands.redo()).toThrow(/destroyed/);
  expect(() => editor.subscribe(() => undefined)).toThrow(/destroyed/);
  expect(() => editor.on('content', () => undefined)).toThrow(/destroyed/);
  expect(editor.state).toBe(final);
  expect(other.isDestroyed).toBe(false);
  expect(other.commands.append('C')).toBe(true);
});
