import { expect, test } from 'vitest';
import { z } from 'zod';

import { localHistory } from '../../extensions/history';
import { createSchema, defineNode, type DocumentInput } from '../../model';
import { createStateField, textSelection, type NodeAccess } from '../../state';
import { createEditor, defineCommand, defineExtension } from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.object({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const group = defineNode({
  name: 'group',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.object({}),
    content: { kind: 'container', field: 'children', allowedGroups: ['block'], minChildren: 1 },
  }),
});

const editing = defineExtension({
  name: 'editing',
  options: {},
  setup: () => ({
    commands: {
      insert: defineCommand({
        execute(context, id: number, text: string) {
          context.step({ kind: 'replaceText', id, from: 0, to: 0, text });

          return true;
        },
      }),
    },
  }),
});

const schema = createSchema({ extensions: [note, group, editing, localHistory] });

const content = [
  { kind: 'group', id: 1, children: [{ kind: 'note', id: 2, text: 'Nested' }] },
  { kind: 'note', id: 3, text: 'Other' },
] satisfies DocumentInput<typeof schema.definitions>;

test('effective access follows ancestors, reads live policy and only visits the requested path', () => {
  const access = new Map<number, NodeAccess>();
  const visited: number[] = [];

  const editor = createEditor({
    schema,
    content,
    permissions: {
      access(node) {
        visited.push(node.id);

        return access.get(node.id) ?? 'editable';
      },
    },
  });

  expect(editor.getAccess(99)).toBeUndefined();
  expect(visited).toEqual([]);
  expect(editor.getAccess(2)).toBe('editable');
  expect(visited).toEqual([2, 1]);
  access.set(1, 'read-only');
  expect(editor.getAccess(2)).toBe('read-only');
  expect(editor.getAccess(3)).toBe('editable');
  expect(editor.can().insert(2, 'Denied')).toBe(false);
  expect(editor.commands.insert(2, 'Denied')).toBe(false);
  access.set(2, 'protected');
  expect(editor.getAccess(2)).toBe('protected');
  access.set(1, 'protected');
  access.set(2, 'editable');
  expect(editor.getAccess(2)).toBe('protected');
  editor.destroy();
  expect(() => editor.getAccess(2)).toThrow('Editor is destroyed');
});

test('permission refresh publishes a new observable snapshot without changing document revisions, anchors or history', () => {
  let writable = true;

  const editor = createEditor({
    schema,
    content,
    permissions: { access: () => (writable ? 'editable' : 'read-only') },
  });

  editor.commands.insert(2, 'New ');
  editor.select(textSelection(2, 4));
  const before = editor.state;
  const checkpoint = editor.positions.checkpoint();
  const position = editor.positions.at(2, 4, 1);
  const pending = editor.chain().insert(2, 'Obsolete');
  const events: string[] = [];
  editor.on('update', (event) => events.push(event.kind));
  editor.on('content', () => events.push('content'));
  editor.on('transaction', () => events.push('transaction'));
  editor.on('selection', () => events.push('selection'));
  editor.subscribe(() => events.push('view'));
  writable = false;
  editor.refreshPermissions();
  expect(events).toEqual(['permissions', 'view']);
  expect(editor.state).not.toBe(before);
  expect(editor.state.nodes).toBe(before.nodes);
  expect(editor.state.selection).toBe(before.selection);
  expect(editor.state.revision).toBe(before.revision);
  expect(editor.history).toEqual({ undo: 1, redo: 0 });
  expect(editor.positions.checkpoint()).toEqual(checkpoint);
  expect(editor.positions.resolve(position)).toMatchObject({
    status: 'resolved',
    point: { id: 2, offset: 4 },
  });
  expect(pending.run()).toBe(false);
  expect(editor.can().undo()).toBe(false);
  writable = true;
  editor.refreshPermissions();
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getAccess(2)).toBe('editable');
  expect(editor.schema.text(editor.schema.children(editor.state.nodes[0])[0])).toBe('Nested');
  editor.destroy();
  expect(() => editor.refreshPermissions()).toThrow('Editor is destroyed');
});

test('permission refresh prepares extension state atomically and supports retry after a reducer rejects it', () => {
  let reject = true;

  const count = createStateField({
    create: () => 0,
    update(value, event) {
      if (event.kind !== 'permissions') return value;

      if (reject) throw new Error('Cannot refresh yet');

      return value + 1;
    },
  });

  const field = defineExtension({ name: 'field', options: {}, setup: () => ({ fields: [count] }) });

  const editor = createEditor({
    schema: createSchema({ extensions: [note, field] }),
    content: [{ kind: 'note', id: 1, text: 'Text' }],
  });

  let published = 0;
  editor.subscribe(() => {
    published++;
  });
  const before = editor.state;
  expect(() => editor.refreshPermissions()).toThrow('Cannot refresh yet');
  expect(editor.state).toBe(before);
  expect(published).toBe(0);
  reject = false;
  editor.refreshPermissions();
  expect(count.read(editor.state)).toBe(1);
  expect(published).toBe(1);
  editor.destroy();
});
