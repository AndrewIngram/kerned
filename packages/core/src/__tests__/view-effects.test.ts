import { localHistory } from '@gprose/extension-history';
import { createSchema, defineNode } from '@gprose/model';
import { textSelection } from '@gprose/state';
import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { connectEditorView, createEditor, defineCommand, defineExtension } from '../index.js';

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
          const value = context.schema.text(node);

          if (value === null) return false;
          context.apply({
            steps: [
              { kind: 'replaceText', id: node.id, from: value.length, to: value.length, text },
            ],
            selection: textSelection(node.id, value.length + text.length),
          });

          return true;
        },
      }),
      unavailable: defineCommand({ execute: () => false }),
    },
  }),
});

const schema = createSchema({ extensions: [note, editing, localHistory] });

const session = () => createEditor({ schema, content: [{ kind: 'note', id: 1, text: 'A' }] });

test('focus and reveal run after publication against the final selection and never in dry runs', () => {
  const editor = session();
  const observed: string[] = [];
  connectEditorView(editor, {
    focus: () => observed.push(`focus:${editor.state.nodes[0].text}`),
    reveal: (selection) => {
      expect(selection).toBe(editor.state.selection);
      expect(selection).toEqual(textSelection(1, 3));
      observed.push('reveal');
    },
    destroy() {},
  });
  editor.on('content', () => observed.push('content'));
  editor.subscribe(() => observed.push('invalidate'));
  expectTypeOf(editor.commands.focus).parameters.toEqualTypeOf<[]>();
  expect(editor.getCommandState('focus')).toEqual({ available: true, activity: 'inactive' });
  expect(editor.can().chain().focus().append('BC').scrollIntoView().run()).toBe(true);
  expect(observed).toEqual([]);
  const chain = editor.chain().focus().scrollIntoView().append('BC');
  expect(observed).toEqual([]);
  expect(chain.run()).toBe(true);
  expect(observed).toEqual(['content', 'invalidate', 'focus:ABC', 'reveal']);
  expect(editor.history.undo).toBe(1);
});

test('headless view commands are no-ops and failed or stale chains cannot execute view effects', () => {
  const editor = session();
  const initial = editor.state;
  expect(editor.chain().focus().scrollIntoView().run()).toBe(true);
  expect(editor.state).toBe(initial);
  expect(editor.history.undo).toBe(0);
  const observed: string[] = [];
  connectEditorView(editor, {
    focus: () => observed.push('focus'),
    reveal: () => observed.push('reveal'),
    destroy() {},
  });
  expect(editor.chain().focus().append('discard').scrollIntoView().unavailable().run()).toBe(false);
  expect(editor.state).toBe(initial);
  expect(observed).toEqual([]);
  const stale = editor.chain().focus().append('discard');
  editor.commands.append('B');
  expect(stale.run()).toBe(false);
  expect(observed).toEqual([]);
});

test('queued effects never switch to a replacement view and attachment cleanup is idempotent', () => {
  const editor = session();
  const observed: string[] = [];

  const detach = connectEditorView(editor, {
    focus: () => observed.push('old'),
    reveal() {},
    destroy() {},
  });

  const chain = editor.chain().focus().append('B');
  detach();
  detach();
  connectEditorView(editor, { focus: () => observed.push('new'), reveal() {}, destroy() {} });
  detach();
  expect(chain.run()).toBe(true);
  expect(editor.state.nodes[0].text).toBe('AB');
  expect(observed).toEqual([]);
  expect(editor.commands.focus()).toBe(true);
  expect(observed).toEqual(['new']);
  expect(() => connectEditorView(editor, { focus() {}, reveal() {}, destroy() {} })).toThrow(
    /one mounted view/,
  );
});

test('session disposal destroys its view once before lifecycle observers, without affecting another editor', () => {
  const editor = session();
  const other = session();
  const observed: string[] = [];

  const detach = connectEditorView(editor, {
    focus() {},
    reveal() {},
    destroy() {
      observed.push('view');
      detach();
    },
  });

  connectEditorView(other, { focus: () => observed.push('other'), reveal() {}, destroy() {} });
  editor.on('destroy', () => observed.push('session'));
  const pending = editor.chain().focus();
  editor.destroy();
  editor.destroy();
  expect(observed).toEqual(['view', 'session']);
  expect(() => pending.run()).toThrow(/destroyed/);
  expect(() => connectEditorView(editor, { focus() {}, reveal() {}, destroy() {} })).toThrow(
    /destroyed/,
  );
  other.commands.focus();
  expect(observed).toEqual(['view', 'session', 'other']);
});

test('extensions cannot replace session-owned view commands', () => {
  const conflict = defineExtension({
    name: 'conflict',
    options: {},
    setup: () => ({ commands: { focus: defineCommand({ execute: () => true }) } }),
  });

  expect(() =>
    createEditor({ schema: createSchema({ extensions: [note, conflict] }), content: [] }),
  ).toThrow('Duplicate command focus: editorView and conflict');
});
