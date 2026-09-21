import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createSchema, defineNode, defineMark, type DocumentNode } from '../../model';
import {
  createEditor,
  createStateField,
  textSelection,
  TextSelection,
  type Transaction,
  type Command,
  type ExtensionUpdate,
  type EditorOptions,
} from '../index';

const definitions = [
  defineNode({
    name: 'note',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ text: z.string() }),
      content: { kind: 'text', field: 'text', marks: 'marks' },
    }),
  }),
  defineMark({
    name: 'bold',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.null() }),
  }),
] as const;

type Note = DocumentNode<typeof definitions>;

const schema = createSchema({ extensions: definitions });

function session(options: EditorOptions<Note> = {}) {
  return createEditor(
    schema,
    [{ kind: 'note', id: 1, key: 'one', text: 'A', marks: [] }],
    textSelection(1, 1),
    [],
    options,
  );
}

const append: Command<Note, [string]> = (context, text) => {
  const node = context.state.nodes[0];
  context.step({
    kind: 'replaceText',
    id: node.id,
    from: node.text.length,
    to: node.text.length,
    text,
  });

  return true;
};

test('nested commands share the current draft and publish one undoable edit', () => {
  const editor = session();
  const updates: ExtensionUpdate<Note>[] = [];
  editor.on('update', (update) => updates.push(update));

  const twice: Command<Note, [string]> = (context, text) =>
    context.command(append, text) && context.command(append, text);

  expect(editor.chain().command(twice, '!').command(append, '?').run()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('A!!?');
  expect(updates.map((update) => update.kind)).toEqual(['transaction']);
  expect(editor.history.undo).toBe(1);
  editor.undo();
  expect(editor.state.nodes[0].text).toBe('A');
  editor.redo();
  expect(editor.state.nodes[0].text).toBe('A!!?');
});

test('an edit publishes content, selection and stored marks as one consistent draft transition', () => {
  const field = createStateField<Note, number>({
    create: () => 0,
    update(count, event) {
      if (event.kind !== 'transaction') return count;
      const last = event.after.nodes.at(-1);

      if (
        event.after.nodes.length > event.before.nodes.length &&
        last &&
        !event.after.selection.eq(textSelection(last.id, 0))
      )
        throw new Error('New content must arrive with its selection');

      return count + 1;
    },
  });

  const editor = session({ fields: [field] });
  const initial = editor.state;

  const insert: Command<Note> = (context) => {
    const node = context.schema.node(definitions[0]).create(context.allocate(), { text: 'New' });
    context.apply({
      steps: [{ kind: 'insertChildren', parent: null, index: 1, nodes: [node] }],
      selection: textSelection(node.id, 0),
      storedMarks: [{ type: 'bold', attrs: null }],
    });
    expect(context.state.selection.eq(textSelection(node.id, 0))).toBe(true);
    expect(field.read(context.state)).toBe(1);

    return true;
  };

  expect(editor.can().command(insert).run()).toBe(true);
  expect(editor.state).toBe(initial);
  expect(editor.chain().command(insert).run()).toBe(true);
  expect(editor.state.nodes.map((node) => node.text)).toEqual(['A', 'New']);
  expect(editor.state.storedMarks).toEqual([{ type: 'bold', attrs: null }]);
  expect(field.read(editor.state)).toBe(1);
  expect(editor.history.undo).toBe(1);
  editor.undo();
  expect(editor.state.nodes).toEqual(initial.nodes);
});

test('an ignored nested false still aborts the chain and drops deferred effects', () => {
  const editor = session();
  const initial = editor.state;
  const effects: string[] = [];

  const outer: Command<Note> = (context) => {
    context.command(append, 'discard');
    context.effect(() => effects.push('focus'));
    context.command(() => false);
    context.command(append, 'also discarded');

    return true;
  };

  expect(editor.chain().command(outer).run()).toBe(false);
  expect(editor.state).toBe(initial);
  expect(editor.history.undo).toBe(0);
  expect(effects).toEqual([]);
});

test('a command exception leaves its prepared chain unable to publish partial edits', () => {
  const editor = session();
  const chain = editor.chain();
  const initial = editor.state;

  expect(() =>
    chain.command((context) => {
      context.command(append, 'discard');
      throw new Error('Command failed');
    }),
  ).toThrow('Command failed');
  expect(chain.run()).toBe(false);
  expect(editor.state).toBe(initial);
});

test('nested dry runs have no notifications, history or effects and enforce permissions', () => {
  const editor = session();
  const initial = editor.state;
  const observed: string[] = [];
  editor.on('update', () => observed.push('update'));
  editor.subscribe(() => observed.push('invalidate'));

  expect(
    editor
      .can()
      .command((context) => {
        context.effect(() => observed.push('focus'));

        return context.command(append, '?');
      })
      .run(),
  ).toBe(true);
  expect(editor.state).toBe(initial);
  expect(editor.history).toEqual({ undo: 0, redo: 0 });
  expect(observed).toEqual([]);

  const protectedEditor = session({ permissions: { access: () => 'read-only' } });
  expect(
    protectedEditor
      .can()
      .command((context) => context.command(append, '!'))
      .run(),
  ).toBe(false);
});

test('semantic updates precede invalidation and report selection, marks, history and transactions', () => {
  const editor = session();
  const observed: string[] = [];
  const updates: ExtensionUpdate<Note>[] = [];

  editor.on('update', (update) => {
    expect(editor.state).toBe(update.after);
    expect(editor.state).not.toBe(update.before);
    updates.push(update);
    observed.push(update.kind);
  });
  editor.subscribe(() => observed.push('invalidate'));
  editor.select(textSelection(1, 0));
  editor.setStoredMarks([schema.marks.create('bold', null)]);
  editor.chain().command(append, '!').run();
  editor.undo();
  editor.redo();
  expect(observed).toEqual([
    'selection',
    'invalidate',
    'storedMarks',
    'invalidate',
    'transaction',
    'invalidate',
    'undo',
    'invalidate',
    'redo',
    'invalidate',
  ]);
  const transaction = updates[2];

  if (transaction.kind !== 'transaction') throw new Error('Expected a transaction update');
  expect(transaction.transaction.steps).toHaveLength(1);
  expect(transaction.mapping.before).toBe(transaction.before);
  expect(transaction.mapping.after).toBe(transaction.after);
});

test('subscriptions are snapshotted for publication and unsubscribe is idempotent', () => {
  const editor = session();
  const observed: string[] = [];
  const unsubscribe = editor.subscribe(() => observed.push('existing'));

  const stopUpdate = editor.on('update', () => {
    observed.push('update');
    unsubscribe();
    editor.subscribe(() => observed.push('new'));
  });

  editor.select(textSelection(1, 0));
  expect(observed).toEqual(['update', 'existing']);
  stopUpdate();
  stopUpdate();
  observed.length = 0;
  editor.select(textSelection(1, 1));
  expect(observed).toEqual(['new']);
});

test('both semantic and invalidation subscribers cannot recursively publish another state', () => {
  const editor = session();
  const observed: string[] = [];

  function subscriber() {
    const current = editor.state;
    expect(() => editor.select(textSelection(1, 0))).toThrow(/during publication/);
    expect(() => editor.chain().command(append, '!').run()).toThrow(/during publication/);
    expect(() => editor.undo()).toThrow(/during publication/);
    expect(editor.state).toBe(current);
    observed.push(current.nodes[0].text);
  }

  const stopUpdate = editor.on('update', subscriber);
  const stopInvalidate = editor.subscribe(subscriber);
  editor.chain().command(append, '?').run();
  expect(observed).toEqual(['A?', 'A?']);
  stopUpdate();
  stopInvalidate();
  expect(editor.chain().command(append, '!').run()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('A?!');
});

test('a failed imperative draft operation also prevents partial publication', () => {
  const editor = session();
  const chain = editor.chain().command(append, 'discard');
  const initial = editor.state;

  expect(() => chain.select(textSelection(1, 999))).toThrow(/selection|offset|range/i);
  expect(chain.run()).toBe(false);
  expect(editor.state).toBe(initial);
});

test('transaction fields and revisions describe one atomic draft throughout a chain', () => {
  const transactions = createStateField<Note, number>({
    create: () => 0,
    update: (value, event) => value + (event.kind === 'transaction' ? 1 : 0),
  });

  const inserted = createStateField<Note, number>({
    create: () => 0,
    update: (value, event) =>
      value + (event.kind === 'transaction' ? event.transaction.steps.length : 0),
  });

  const editor = session({ fields: [transactions, inserted] });
  const initial = editor.state;
  const snapshots: (typeof initial)[] = [];

  const chain = editor
    .chain()
    .command(append, '!')
    .command((context) => {
      snapshots.push(context.state);
      expect(transactions.read(context.state)).toBe(1);
      expect(inserted.read(context.state)).toBe(1);

      return context.command(append, '?');
    })
    .command((context) => {
      snapshots.push(context.state);
      expect(transactions.read(context.state)).toBe(1);
      expect(inserted.read(context.state)).toBe(2);
      expect(context.state.revision).toBe(initial.revision + 1);

      return true;
    });

  expect(chain.run()).toBe(true);
  expect(transactions.read(editor.state)).toBe(1);
  expect(inserted.read(editor.state)).toBe(2);
  expect(editor.state.revision).toBe(initial.revision + 1);
  expect(transactions.read(initial)).toBe(0);
  expect(inserted.read(snapshots[0])).toBe(1);
  expect(inserted.read(snapshots[1])).toBe(2);
});

test('field previews retain the complete mapping and the published transaction metadata', () => {
  const events = createStateField<Note, ExtensionUpdate<Note> | null>({
    create: () => null,
    update: (_value, event) => event,
  });

  const editor = session({ fields: [events] });
  const initial = editor.state;
  let preview: ExtensionUpdate<Note> | null = null;

  const chain = editor
    .chain()
    .command(append, '!')
    .command(append, '?')
    .command((context) => {
      preview = events.read(context.state);

      return true;
    });

  expect(chain.run()).toBe(true);
  const published = events.read(editor.state);
  expect(preview).toEqual(published);
  expect(published?.before).toBe(initial);

  if (published?.kind !== 'transaction') throw new Error('Expected transaction');
  expect(published.transaction.steps).toHaveLength(2);
  expect(published.mapping.maps).toHaveLength(2);
  expect(published.mapping.before).toBe(initial);
  expect(published.mapping.after).toBe(editor.state);
});

test('stored mark commands preview the same field event and revision they publish', () => {
  const events = createStateField<Note, string[]>({
    create: () => [],
    update: (value, event) => [...value, event.kind],
  });

  const editor = session({ fields: [events] });
  const initial = editor.state;
  const bold = schema.marks.create('bold', null);

  const command: Command<Note> = (context) => {
    context.storedMarks([bold]);
    context.storedMarks([]);
    expect(events.read(context.state)).toEqual(['storedMarks']);
    expect(context.state.revision).toBe(initial.revision);

    return true;
  };

  expect(editor.can().command(command).run()).toBe(true);
  expect(editor.state).toBe(initial);
  expect(events.read(initial)).toEqual([]);
  expect(editor.chain().command(command).run()).toBe(true);
  expect(events.read(editor.state)).toEqual(['storedMarks']);
  expect(editor.state.storedMarks).toEqual([]);
  expect(editor.state.revision).toBe(initial.revision);
  expect(editor.history.undo).toBe(0);
});

const typeText: Command<Note, [string]> = (context, text) => {
  const selection = context.state.selection;

  if (!(selection instanceof TextSelection) || selection.anchor.id !== selection.head.id)
    return false;
  const from = Math.min(selection.anchor.offset, selection.head.offset);
  const to = Math.max(selection.anchor.offset, selection.head.offset);
  context.apply({
    input: true,
    steps: [{ kind: 'replaceText', id: selection.head.id, from, to, text }],
    selection: textSelection(selection.head.id, from + text.length),
  });

  return true;
};

test('input records per-operation marks so mixed-format chains replay and undo exactly', () => {
  const editor = session();
  const bold = [{ type: 'bold', attrs: null }];
  let transaction: Transaction<Note> | undefined;
  editor.on('update', (event) => {
    if (event.kind === 'transaction') transaction = event.transaction;
  });
  const initial = editor.state;
  expect(
    editor
      .can()
      .storedMarks(bold)
      .command(typeText, 'B')
      .storedMarks([])
      .command(typeText, 'C')
      .run(),
  ).toBe(true);
  expect(editor.state).toBe(initial);
  expect(
    editor
      .chain()
      .storedMarks(bold)
      .command(typeText, 'B')
      .storedMarks([])
      .command(typeText, 'C')
      .run(),
  ).toBe(true);
  expect(editor.state.nodes[0]).toMatchObject({
    text: 'ABC',
    marks: [{ from: 1, to: 2, mark: bold[0] }],
  });
  expect(editor.state.storedMarks).toEqual([]);

  if (!transaction) throw new Error('Missing transaction');
  expect(transaction.steps).toMatchObject([
    { text: 'B', marks: bold },
    { text: 'C', marks: [] },
  ]);
  const replay = session();
  replay.dispatch(transaction);
  expect(replay.state).toEqual(editor.state);
  editor.undo();
  expect(editor.state.nodes).toEqual(initial.nodes);
  editor.redo();
  expect(editor.state.nodes).toEqual(replay.state.nodes);
});

test('command history options group typing and publish identical draft and final metadata', () => {
  const field = createStateField<Note, { group: string | null; time: number }>({
    create: () => ({ group: null, time: -1 }),
    update(value, event) {
      if (event.kind !== 'transaction' || event.transaction.origin !== 'local') return value;

      return {
        group: event.transaction.history === 'separate' ? null : event.transaction.history.group,
        time: event.transaction.time,
      };
    },
  });

  const editor = session({ fields: [field] });
  expect(
    editor
      .chain({ history: { group: 'typing:one' }, time: 100 })
      .command(typeText, 'B')
      .run(),
  ).toBe(true);
  const initial = editor.state;
  expect(
    editor
      .can({ history: { group: 'typing:one' }, time: 200 })
      .command(typeText, 'C')
      .run(),
  ).toBe(true);
  expect(editor.state).toBe(initial);
  expect(
    editor
      .chain({ history: { group: 'typing:one' }, time: 200 })
      .command(typeText, 'C')
      .command((context) => {
        expect(field.read(context.state)).toEqual({ group: 'typing:one', time: 200 });

        return true;
      })
      .run(),
  ).toBe(true);
  expect(editor.history.undo).toBe(1);
  expect(field.read(editor.state)).toEqual({ group: 'typing:one', time: 200 });
  editor
    .chain({ history: { group: 'typing:one' }, time: 1000 })
    .command(typeText, 'D')
    .run();
  expect(editor.history.undo).toBe(2);
  editor.undo();
  expect(editor.state.nodes[0].text).toBe('ABC');
  editor.undo();
  expect(editor.state.nodes[0].text).toBe('A');
});

test('snapshots expose readonly fields and accept a frozen document without copying untouched nodes', () => {
  const nodes = Object.freeze([
    Object.freeze({ kind: 'note', id: 1, key: 'one', text: 'A', marks: [] }),
    Object.freeze({ kind: 'note', id: 2, key: 'two', text: 'B', marks: [] }),
  ] satisfies Note[]);

  const editor = createEditor(schema, nodes, textSelection(1, 1));
  const before = editor.state;
  expectTypeOf(before).toEqualTypeOf<Readonly<typeof before>>();
  expectTypeOf(before.nodes).toEqualTypeOf<readonly Note[]>();
  expect(before.nodes).toBe(nodes);
  expect(editor.chain().command(append, '!').command(append, '?').run()).toBe(true);
  expect(before.nodes[0].text).toBe('A');
  expect(before.revision).toBe(0);
  expect(editor.state.nodes[0].text).toBe('A!?');
  expect(editor.state.nodes[1]).toBe(nodes[1]);
  editor.undo();
  expect(editor.state.nodes[0]).toBe(nodes[0]);
  editor.redo();
  expect(editor.state.nodes[0].text).toBe('A!?');
  expect(editor.state.nodes[1]).toBe(nodes[1]);
});

test('draft fields see stable snapshot identities and cumulative revisions before publication', () => {
  const observations: { state: Parameters<typeof append>[0]['state']; revision: number }[] = [];

  const field = createStateField<Note, number>({
    create: () => 0,
    update(count, event) {
      if (event.kind === 'transaction') {
        expect(event.mapping.after).toBe(event.after);
        observations.push({ state: event.after, revision: event.after.revision });
      }

      return count + 1;
    },
  });

  const editor = session({ fields: [field] });
  const before = editor.state;
  expect(editor.chain().command(append, '!').command(append, '?').run()).toBe(true);
  expect(observations).toHaveLength(3);

  for (const observation of observations) {
    expect(observation.state.revision).toBe(observation.revision);
    expect(observation.revision).toBe(before.revision + 1);
    expect(field.read(observation.state)).toBe(1);
  }

  expect(field.read(before)).toBe(0);
});
