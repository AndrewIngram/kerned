import { localHistory } from '@kerned/extension-history';
import { createSchema, defineNode, type NodeIdentity, type DocumentNode } from '@kerned/model';
import { textSelection, createStateField } from '@kerned/state';
import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import {
  createEditor,
  connectEditorView,
  defineExtension,
  defineCommand,
  type ExtensionContext,
} from '../index.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const editing = defineExtension({
  name: 'editing',
  options: {},
  setup: () => ({
    commands: {
      append: defineCommand({
        execute(context, text: string) {
          const node = context.state.nodes[0];
          const before = context.schema.text(node);

          if (before === null) return false;
          context.apply({
            steps: [
              { kind: 'replaceText', id: node.id, from: before.length, to: before.length, text },
            ],
            selection: textSelection(node.id, before.length + text.length),
          });

          return true;
        },
      }),
    },
  }),
});

const content = [{ kind: 'note', id: 1, key: 'one', text: 'A' }] as const;

test('composed sessions only retain undo history when an extension owns it', () => {
  const schema = createSchema({ extensions: [note, editing] });
  const editor = createEditor({ schema, content: [...content] });
  const position = editor.positions.at(1, 1, 1);
  expect(editor.commands.append('B')).toBe(true);
  expect(editor.history).toEqual({ undo: 0, redo: 0 });
  expect('undo' in editor.commands).toBe(false);
  expect('redo' in editor.commands).toBe(false);
  expect(editor.state.nodes[0].text).toBe('AB');
  expect(editor.positions.resolve(position)).toMatchObject({
    status: 'resolved',
    point: { id: 1, offset: 2 },
  });
});

test('configured local history keeps independent session stacks and obeys retention depth', () => {
  const schema = createSchema({
    extensions: [note, editing, localHistory.configure({ depth: 2 })],
  });

  const editor = createEditor({ schema, content: [...content] });
  const other = createEditor({ schema, content: [...content] });
  editor.commands.append('B');
  editor.commands.append('C');
  editor.commands.append('D');
  expect(editor.history.undo).toBe(2);
  expect(other.history.undo).toBe(0);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.commands.undo()).toBe(false);
  expect(editor.state.nodes[0].text).toBe('AB');
  expect(editor.commands.redo()).toBe(true);
  expect(editor.commands.redo()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('ABCD');
  editor.destroy();
  expect(other.commands.append('!')).toBe(true);
  expect(other.commands.undo()).toBe(true);
  expect(other.state.nodes[0].text).toBe('A');
});

test('history group delay is configurable while composition stays one undoable input', () => {
  const schema = createSchema({
    extensions: [note, editing, localHistory.configure({ newGroupDelay: 20 })],
  });

  const editor = createEditor({ schema, content: [...content] });

  const type = (text: string, time: number, group = 'typing') =>
    editor.chain({ history: { group }, time }).append(text).run();

  type('B', 100);
  type('C', 110);
  type('D', 150);
  expect(editor.history.undo).toBe(2);
  editor.commands.undo();
  expect(editor.state.nodes[0].text).toBe('ABC');
  editor.commands.undo();
  expect(editor.state.nodes[0].text).toBe('A');
  type('E', 200, 'composition:one');
  type('F', 2000, 'composition:one');
  expect(editor.history.undo).toBe(1);
  editor.commands.undo();
  expect(editor.state.nodes[0].text).toBe('A');
});

test('conflicting history owners reject before state creation and dispose prepared resources', () => {
  const disposed: string[] = [];

  const other = defineExtension({
    name: 'otherHistory',
    options: {},
    setup(_options, { onDestroy }: Pick<ExtensionContext<NodeIdentity>, 'onDestroy'>) {
      onDestroy(() => disposed.push('otherHistory'));

      return { history: { depth: 10 } };
    },
  });

  const schema = createSchema({ extensions: [note, localHistory, other] });
  expect(() => createEditor({ schema, content: [] })).toThrow(
    /Conflicting history providers: localHistory, otherHistory/,
  );
  expect(disposed).toEqual(['otherHistory']);
});

test('invalid history configuration rejects before any session can publish content', () => {
  for (const settings of [{ depth: 0 }, { depth: 1.5 }, { newGroupDelay: -1 }]) {
    const schema = createSchema({ extensions: [note, localHistory.configure(settings)] });
    expect(() => createEditor({ schema, content: [] })).toThrow(/History/);
  }
});

test('rejected history replay preserves its stack and durable-position checkpoint for a retry', () => {
  let reject = true;

  const guard = defineExtension({
    name: 'guard',
    options: {},
    setup: () => ({
      fields: [
        createStateField<DocumentNode<readonly [typeof note]>, number>({
          create: () => 0,
          update(value, event) {
            if (reject && (event.kind === 'undo' || event.kind === 'redo'))
              throw new Error('Replay rejected');

            return value + 1;
          },
        }),
      ],
    }),
  });

  const schema = createSchema({ extensions: [note, editing, localHistory, guard] });
  const editor = createEditor({ schema, content: [...content] });
  editor.commands.append('B');
  const before = editor.state;
  const checkpoint = editor.positions.checkpoint();
  expect(() => editor.commands.undo()).toThrow('Replay rejected');
  expect(editor.state).toBe(before);
  expect(editor.history).toEqual({ undo: 1, redo: 0 });
  expect(editor.positions.checkpoint()).toEqual(checkpoint);
  reject = false;
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('A');
  reject = true;
  const undone = editor.state;
  expect(() => editor.commands.redo()).toThrow('Replay rejected');
  expect(editor.state).toBe(undone);
  expect(editor.history).toEqual({ undo: 0, redo: 1 });
  reject = false;
  expect(editor.commands.redo()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('AB');
});

test('named history commands preview without publishing and replay once before queued view effects', () => {
  const schema = createSchema({ extensions: [note, editing, localHistory] });
  const editor = createEditor({ schema, content: [...content] });
  const published: string[] = [];
  const focused: string[] = [];
  editor.on('transaction', (event) => published.push(event.kind));
  connectEditorView(editor, {
    focus: () => focused.push(editor.state.nodes[0].text),
    reveal() {},
    destroy() {},
  });
  expectTypeOf(editor.commands.undo).parameters.toEqualTypeOf<[]>();
  expectTypeOf(editor.can().redo).returns.toEqualTypeOf<boolean>();
  expect(editor.can().undo()).toBe(false);
  editor.commands.append('B');
  const before = editor.state;
  const checkpoint = editor.positions.checkpoint();
  expect(editor.getCommandState('undo')).toEqual({ available: true, activity: 'inactive' });
  expect(editor.can().chain().focus().undo().scrollIntoView().run()).toBe(true);
  expect(editor.state).toBe(before);
  expect(editor.positions.checkpoint()).toEqual(checkpoint);
  expect(editor.history).toEqual({ undo: 1, redo: 0 });
  expect(focused).toEqual([]);
  expect(published).toEqual(['transaction']);
  expect(editor.chain().focus().undo().run()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('A');
  expect(editor.state.revision).toBe(before.revision + 1);
  expect(published).toEqual(['transaction', 'undo']);
  expect(focused).toEqual(['A']);
  expect(editor.can().redo()).toBe(true);
  expect(editor.commands.redo()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('AB');
  expect(published).toEqual(['transaction', 'undo', 'redo']);
});

test('history replay composes with draft inspection and failed or stale chains publish nothing', () => {
  const checks = defineExtension({
    name: 'checks',
    options: {},
    setup: () => ({
      commands: {
        textIs: defineCommand({
          execute: (context, text: string) => context.schema.text(context.state.nodes[0]) === text,
        }),
      },
    }),
  });

  const schema = createSchema({ extensions: [note, editing, localHistory, checks] });
  const editor = createEditor({ schema, content: [...content] });
  editor.commands.append('B');
  const before = editor.state;
  expect(editor.chain().undo().textIs('wrong').run()).toBe(false);
  expect(editor.state).toBe(before);
  expect(editor.history).toEqual({ undo: 1, redo: 0 });
  expect(editor.can().chain().undo().textIs('A').run()).toBe(true);
  const stale = editor.chain().undo();
  editor.commands.append('C');
  expect(stale.run()).toBe(false);
  expect(editor.state.nodes[0].text).toBe('ABC');
  expect(editor.history).toEqual({ undo: 2, redo: 0 });
  expect(editor.chain().undo().textIs('AB').run()).toBe(true);
});

test('history replay and new edits cannot occupy the same atomic command chain', () => {
  const schema = createSchema({ extensions: [note, editing, localHistory] });
  const editor = createEditor({ schema, content: [...content] });
  editor.commands.append('B');
  const before = editor.state;
  const checkpoint = editor.positions.checkpoint();
  expect(editor.chain().undo().append('C').run()).toBe(false);
  expect(editor.chain().append('C').undo().run()).toBe(false);
  expect(editor.chain().undo().redo().run()).toBe(false);
  expect(editor.state).toBe(before);
  expect(editor.positions.checkpoint()).toEqual(checkpoint);
  expect(editor.history).toEqual({ undo: 1, redo: 0 });
  expect(editor.commands.undo()).toBe(true);
  expect(editor.commands.append('C')).toBe(true);
  expect(editor.state.nodes[0].text).toBe('AC');
  expect(editor.can().redo()).toBe(false);
});

test('history commands recheck permissions before replay and suppress pending effects after revocation', () => {
  let writable = true;
  const schema = createSchema({ extensions: [note, editing, localHistory] });

  const editor = createEditor({
    schema,
    content: [...content],
    permissions: { access: () => (writable ? 'editable' : 'read-only') },
  });

  let focused = 0;
  connectEditorView(editor, {
    focus: () => {
      focused++;
    },
    reveal() {},
    destroy() {},
  });
  editor.commands.append('B');
  expect(editor.can().undo()).toBe(true);
  const pending = editor.chain().focus().undo();
  const before = editor.state;
  writable = false;
  expect(pending.run()).toBe(false);
  expect(editor.can().undo()).toBe(false);
  expect(editor.commands.undo()).toBe(false);
  expect(editor.state).toBe(before);
  expect(editor.history).toEqual({ undo: 1, redo: 0 });
  expect(focused).toBe(0);
  writable = true;
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('A');
});

test('a changed history boundary invalidates prepared replay without partially mapping positions', () => {
  const schema = createSchema({ extensions: [note, editing, localHistory] });
  const editor = createEditor({ schema, content: [...content] });
  editor.commands.append('B');
  const pending = editor.chain().undo();
  const before = editor.state;
  const checkpoint = editor.positions.checkpoint();
  editor.breakHistory();
  expect(pending.run()).toBe(false);
  expect(editor.state).toBe(before);
  expect(editor.positions.checkpoint()).toEqual(checkpoint);
  expect(editor.history).toEqual({ undo: 1, redo: 0 });
  expect(editor.commands.undo()).toBe(true);
});

test('long typing groups preserve references from intermediate revisions through replay and checkpoints', () => {
  const schema = createSchema({ extensions: [note, editing, localHistory] });
  const editor = createEditor({ schema, content: [...content], selection: textSelection(1, 1) });
  const initial = editor.state.nodes[0];
  const start = editor.positions.at(1, 1, -1);
  const end = editor.positions.at(1, 1, 1);
  const range = editor.positions.range(start, end);
  const references = [end];

  for (let i = 0; i < 500; i++) {
    editor
      .chain({ history: { group: 'typing' }, time: i })
      .append('x')
      .run();

    if (i % 100 === 0) references.push(editor.positions.at(1, i + 2, 1));
  }

  const resolved = references.map((reference) => editor.positions.resolve(reference));
  expect(editor.history).toEqual({ undo: 1, redo: 0 });
  expect(editor.positions.resolveRange(range)).toMatchObject({
    status: 'resolved',
    ranges: [{ id: 1, from: 1, to: 501 }],
  });
  expect(initial.text).toBe('A');
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes[0]).toBe(initial);
  expect(editor.positions.resolve(end)).toMatchObject({
    status: 'resolved',
    point: { id: 1, offset: 1 },
  });
  expect(editor.commands.redo()).toBe(true);
  expect(references.map((reference) => editor.positions.resolve(reference))).toEqual(resolved);

  const reopened = createEditor({
    schema,
    document: editor.state.nodes,
    revision: editor.state.revision,
    documentId: editor.documentId,
    positionCheckpoint: editor.positions.checkpoint(),
  });

  expect(references.map((reference) => reopened.positions.resolve(reference))).toEqual(resolved);
  expect(reopened.positions.resolveRange(range)).toEqual(editor.positions.resolveRange(range));
  editor.destroy();
  reopened.destroy();
});

test('grouped changes to different roots and structural edits retain replay order', () => {
  const schema = createSchema({ extensions: [note, editing, localHistory] });

  const editor = createEditor({
    schema,
    content: [...content, { kind: 'note', id: 2, key: 'two', text: 'B' }],
  });

  const original = editor.state.nodes;

  for (const id of [1, 1, 2, 2, 1]) {
    const node = editor.getNode(id);

    if (!node) throw new Error('Missing note');
    editor.transact(
      (draft) => {
        draft.apply({
          steps: [
            { kind: 'replaceText', id, from: node.text.length, to: node.text.length, text: '!' },
          ],
        });

        return true;
      },
      { history: { group: 'mixed' }, time: 100 },
    );
  }

  editor.transact(
    (draft) => {
      draft.apply({ steps: [{ kind: 'split', id: 1, at: 2, rightId: 3, rightKey: 'three' }] });

      return true;
    },
    { history: { group: 'mixed' }, time: 100 },
  );
  const changed = editor.state.nodes;
  expect(editor.history.undo).toBe(1);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(original);
  expect(editor.commands.redo()).toBe(true);
  expect(editor.state.nodes).toEqual(changed);
  editor.destroy();
});

test('public sessions load legacy position checkpoints and subsequently save the compact format', () => {
  const schema = createSchema({ extensions: [note, editing, localHistory] });
  const editor = createEditor({ schema, content: [...content], documentId: 'legacy' });
  const position = editor.positions.at(1, 1, 1);
  editor.commands.append('BC');
  editor.commands.undo();
  editor.commands.redo();

  const reopened = createEditor({
    schema,
    document: editor.state.nodes,
    documentId: editor.documentId,
    revision: editor.state.revision,
    positionCheckpoint: {
      version: 1,
      documentId: 'legacy',
      since: 0,
      revision: 3,
      definitions: [
        { id: 1, maps: [{ kind: 'replace', key: 'one', from: 1, to: 1, inserted: 2 }] },
      ],
      events: [
        { revision: 1, operations: [{ id: 1, inverse: false }] },
        { revision: 2, operations: [{ id: 1, inverse: true }] },
        { revision: 3, operations: [{ id: 1, inverse: false }] },
      ],
    },
  });

  expect(reopened.positions.resolve(position)).toEqual(editor.positions.resolve(position));
  expect(reopened.positions.checkpoint().version).toBe(2);

  const roundTrip = createEditor({
    schema,
    document: reopened.state.nodes,
    documentId: reopened.documentId,
    revision: reopened.state.revision,
    positionCheckpoint: JSON.parse(JSON.stringify(reopened.positions.checkpoint())),
  });

  expect(roundTrip.positions.resolve(position)).toEqual(editor.positions.resolve(position));
  editor.destroy();
  reopened.destroy();
  roundTrip.destroy();
});
