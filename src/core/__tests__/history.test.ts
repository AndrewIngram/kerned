import { expect, test } from 'vitest';
import { z } from 'zod';

import { localHistory } from '../../extensions/history';
import { createSchema, defineNode, type NodeIdentity, type DocumentNode } from '../../model';
import { textSelection, createStateField } from '../../state';
import { createEditor, defineExtension, defineCommand, type ExtensionContext } from '../index';

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
  expect(editor.undo()).toBe(false);
  expect(editor.redo()).toBe(false);
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
  expect(editor.undo()).toBe(true);
  expect(editor.undo()).toBe(true);
  expect(editor.undo()).toBe(false);
  expect(editor.state.nodes[0].text).toBe('AB');
  expect(editor.redo()).toBe(true);
  expect(editor.redo()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('ABCD');
  editor.destroy();
  expect(other.commands.append('!')).toBe(true);
  expect(other.undo()).toBe(true);
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
  editor.undo();
  expect(editor.state.nodes[0].text).toBe('ABC');
  editor.undo();
  expect(editor.state.nodes[0].text).toBe('A');
  type('E', 200, 'composition:one');
  type('F', 2000, 'composition:one');
  expect(editor.history.undo).toBe(1);
  editor.undo();
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
  expect(() => editor.undo()).toThrow('Replay rejected');
  expect(editor.state).toBe(before);
  expect(editor.history).toEqual({ undo: 1, redo: 0 });
  expect(editor.positions.checkpoint()).toEqual(checkpoint);
  reject = false;
  expect(editor.undo()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('A');
  reject = true;
  const undone = editor.state;
  expect(() => editor.redo()).toThrow('Replay rejected');
  expect(editor.state).toBe(undone);
  expect(editor.history).toEqual({ undo: 0, redo: 1 });
  reject = false;
  expect(editor.redo()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('AB');
});
