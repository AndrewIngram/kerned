import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor } from '../../../core';
import { createSchema, defineNode, indexTree } from '../../../model';
import { TextSelection, textSelection } from '../../../state';
import { starterExtensions } from '../index';

const caption = defineNode({
  name: 'caption',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({ value: z.string() }),
    content: { kind: 'text', field: 'value', marks: 'styles' },
  }),
});

const schema = createSchema({ extensions: [...starterExtensions, caption] });

test('split and deletion use custom text storage, grapheme boundaries and atomic undo', () => {
  const family = '👨‍👩‍👧‍👦';

  const editor = createEditor({
    schema,
    content: [{ kind: 'caption', id: 1, value: `Aé${family}Z` }],
  });

  editor.select(textSelection(1, 3 + family.length));
  const initial = editor.state;
  expect(editor.can().chain().deleteBackward().deleteForward().run()).toBe(true);
  expect(editor.state).toBe(initial);
  expect(editor.chain().deleteBackward().deleteForward().run()).toBe(true);
  expect(editor.state.nodes[0]).toMatchObject({ value: 'Aé' });
  expect(editor.state.selection).toEqual(textSelection(1, 3));
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(initial.nodes);

  editor.select(textSelection(1, 3));
  expect(editor.commands.deleteBackward()).toBe(true);
  expect(editor.state.nodes[0]).toMatchObject({ value: `A${family}Z` });
  editor.select(textSelection(1, 1));
  const beforeSplit = editor.state;
  expect(editor.can().splitBlock()).toBe(true);
  expect(editor.state).toBe(beforeSplit);
  expect(editor.commands.splitBlock()).toBe(true);
  expect(editor.state.nodes).toMatchObject([{ value: 'A' }, { value: `${family}Z` }]);
  expect(editor.commands.deleteBackward()).toBe(true);
  expect(editor.state.nodes).toMatchObject([{ id: 1, value: `A${family}Z` }]);
});

test('list Enter retains stored marks and Backspace joins items with custom text', () => {
  const editor = createEditor({
    schema,
    content: [
      {
        kind: 'list',
        id: 10,
        ordered: false,
        start: 1,
        children: [
          { kind: 'listItem', id: 11, children: [{ kind: 'caption', id: 1, value: 'AB' }] },
        ],
      },
    ],
  });

  editor.select(textSelection(1, 1));
  expect(editor.commands.toggleFormat('bold')).toBe(true);
  const before = editor.state;
  expect(editor.commands.splitBlock()).toBe(true);
  const list = editor.state.nodes[0];
  expect(schema.children(list)).toHaveLength(2);
  expect(
    schema.children(list).map((item) => schema.children(item).map((node) => schema.text(node))),
  ).toEqual([['A'], ['B']]);
  expect(editor.state.storedMarks).toEqual([{ type: 'bold', attrs: null }]);
  expect(editor.commands.deleteBackward()).toBe(true);
  expect(schema.children(editor.state.nodes[0])).toHaveLength(1);
  expect(indexTree(schema, editor.state.nodes).byId.get(1)?.node).toMatchObject({ value: 'AB' });
  editor.commands.undo();
  editor.commands.undo();
  expect(editor.state.nodes).toEqual(before.nodes);
  expect(editor.state.storedMarks).toEqual(before.storedMarks);
});

test('Enter replaces a cross-block selection and splits as one undoable command', () => {
  const editor = createEditor({
    schema,
    content: [
      { kind: 'caption', id: 1, value: 'AB' },
      { kind: 'paragraph', id: 2, text: 'CD' },
    ],
  });

  editor.select(new TextSelection({ id: 1, offset: 1 }, { id: 2, offset: 1 }));
  const before = editor.state;
  expect(editor.commands.splitBlock()).toBe(true);
  expect(editor.state.nodes.map((node) => schema.text(node))).toEqual(['A', 'D']);
  expect(editor.history.undo).toBe(1);
  editor.commands.undo();
  expect(editor.state.nodes).toEqual(before.nodes);
  expect(editor.state.selection).toEqual(before.selection);
});

test('empty quotes unwrap and later text blocks in list items join without outdenting', () => {
  const editor = createEditor({
    schema,
    content: [
      { kind: 'quote', id: 10, children: [{ kind: 'caption', id: 1, value: '' }] },
      {
        kind: 'list',
        id: 20,
        ordered: true,
        start: 1,
        children: [
          {
            kind: 'listItem',
            id: 21,
            children: [
              { kind: 'caption', id: 2, value: 'A' },
              { kind: 'caption', id: 3, value: 'B' },
            ],
          },
        ],
      },
    ],
  });

  editor.select(textSelection(1, 0));
  expect(editor.commands.splitBlock()).toBe(true);
  expect(editor.state.nodes[0]).toMatchObject({ kind: 'caption', id: 1 });
  editor.select(textSelection(3, 0));
  expect(editor.commands.deleteBackward()).toBe(true);
  const list = editor.state.nodes[1];
  expect(list.kind).toBe('list');
  expect(schema.children(list)).toHaveLength(1);
  expect(schema.children(schema.children(list)[0])).toMatchObject([
    { kind: 'caption', id: 2, value: 'AB' },
  ]);
});

test('text deletion respects table cell boundaries and permissions', () => {
  const content = [
    {
      kind: 'table' as const,
      id: 10,
      caption: '',
      rows: [
        [
          {
            kind: 'tableCell' as const,
            id: 11,
            row: 0,
            header: false,
            colspan: 1,
            rowspan: 1,
            paragraphs: [{ kind: 'caption' as const, id: 1, value: 'A' }],
          },
          {
            kind: 'tableCell' as const,
            id: 12,
            row: 0,
            header: false,
            colspan: 1,
            rowspan: 1,
            paragraphs: [{ kind: 'caption' as const, id: 2, value: 'B' }],
          },
        ],
      ],
    },
  ];

  const editor = createEditor({ schema, content });
  editor.select(textSelection(2, 0));
  const before = editor.state;
  expect(editor.commands.deleteBackward()).toBe(false);
  expect(editor.state).toBe(before);
  editor.select(textSelection(1, 1));
  expect(editor.commands.deleteForward()).toBe(false);

  const protectedEditor = createEditor({
    schema,
    content,
    permissions: { access: () => 'read-only' },
  });

  protectedEditor.select(textSelection(1, 1));
  expect(protectedEditor.can().deleteBackward()).toBe(false);
  expect(protectedEditor.commands.splitBlock()).toBe(false);
  expect(protectedEditor.history.undo).toBe(0);
});

test('typing commands use draft marks across custom text splits and explicit native target edits', () => {
  const editor = createEditor({
    schema,
    content: [
      { kind: 'caption', id: 1, value: 'AB' },
      { kind: 'caption', id: 2, value: 'Other' },
    ],
  });

  editor.select(textSelection(1, 1));
  const before = editor.state;
  expect(
    editor.can().chain().toggleFormat('bold').insertText('X').splitBlock().insertText('Y').run(),
  ).toBe(true);
  expect(editor.state).toBe(before);
  expect(
    editor.chain().toggleFormat('bold').insertText('X').splitBlock().insertText('Y').run(),
  ).toBe(true);
  expect(editor.state.nodes).toMatchObject([
    { value: 'AX', styles: [{ from: 1, to: 2, mark: { type: 'bold' } }] },
    { value: 'YB', styles: [{ from: 0, to: 1, mark: { type: 'bold' } }] },
    { value: 'Other' },
  ]);
  expect(editor.history.undo).toBe(1);
  editor.commands.undo();
  expect(editor.state.nodes).toEqual(before.nodes);
  // An explicit native target moves to that text without inheriting unrelated stored marks.
  editor.commands.toggleFormat('italic');
  expect(editor.commands.replaceText({ id: 2, from: 1, to: 4, text: 'X', caret: 0 })).toBe(true);
  expect(editor.state.nodes[1]).toMatchObject({ value: 'OXr', styles: [] });
  expect(editor.state.selection).toEqual(textSelection(2, 0));
  const current = editor.state;
  expect(() =>
    editor.commands.replaceText({ id: 2, from: 0, to: 0, text: 'Z', caret: 99 }),
  ).toThrow('Edit range must follow grapheme boundaries');
  expect(editor.state).toBe(current);
});

test('plain text paste creates paragraphs within the current table cell', () => {
  const editor = createEditor({
    schema,
    content: [
      {
        kind: 'table',
        id: 10,
        caption: '',
        rows: [
          [
            {
              kind: 'tableCell',
              id: 11,
              row: 0,
              header: false,
              colspan: 1,
              rowspan: 1,
              paragraphs: [{ kind: 'caption', id: 1, value: 'AB' }],
            },
          ],
        ],
      },
    ],
  });

  editor.select(textSelection(1, 1));
  const before = editor.state;
  expect(editor.commands.pasteText('one\ntwo\nthree')).toBe(true);
  const cell = indexTree(schema, editor.state.nodes).byId.get(11)?.node;

  if (!cell) throw new Error('Expected cell');
  expect(schema.children(cell).map((node) => schema.text(node))).toEqual(['Aone', 'two', 'threeB']);
  expect(editor.history.undo).toBe(1);
  editor.commands.undo();
  expect(editor.state.nodes).toEqual(before.nodes);
});
