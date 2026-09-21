import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineCommand, defineQuery } from '../../core';
import { createSchema, defineNode } from '../../model';
import { NodeSelection, TextSelection, textSelection, toggleMarkCommand } from '../../state';
import { localHistory } from '../history';
import { starterDefinitions } from '../starter-definitions';
import { starterFormatting } from '../starter-kit/formatting';
import { starterStructure } from '../starter-kit/structure';
import { starterTables } from '../starter-kit/tables';
import { tableCells } from '../table';
import { textCommands } from '../text-commands';

const caption = defineNode({
  name: 'caption',
  version: 1,
  options: {},
  requires: ['bold'],
  schema: () => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({ value: z.string() }),
    content: { kind: 'text', field: 'value', marks: 'styles' },
  }),
  setup() {
    return {
      commands: {
        toggleCaptionBold: defineCommand({
          execute(context) {
            return context.command(
              toggleMarkCommand(context.schema, { type: 'bold', attrs: null }),
            );
          },
          activity: ({ schema, state }) => textCommands(schema, state).activity('bold'),
        }),
        clearCaptionMarks: defineCommand({
          execute(context) {
            const formatting = textCommands(context.schema, context.state);

            if (!formatting.available) return false;

            if (formatting.caret) context.storedMarks([]);
            else context.steps(formatting.clear());

            return true;
          },
        }),
      },
      queries: {
        captionFormatAvailable: defineQuery(
          ({ schema, state }) => textCommands(schema, state).available,
        ),
      },
    };
  },
});

const widget = defineNode({
  name: 'widget',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({ label: z.string() }),
    content: { kind: 'atom' },
  }),
});

const schema = createSchema({
  extensions: [
    ...starterDefinitions,
    localHistory,
    starterFormatting,
    starterStructure,
    caption,
    widget,
  ],
});

test('a node-owned formatting contribution operates in open nested documents', () => {
  const editor = createEditor({
    schema,
    content: [
      {
        kind: 'quote',
        children: [
          { kind: 'caption', id: 1, value: 'Custom' },
          { kind: 'widget', id: 2, label: 'Card' },
          { kind: 'paragraph', id: 3, text: 'Standard' },
        ],
      },
    ],
  });

  expectTypeOf(editor.commands.toggleCaptionBold).parameters.toEqualTypeOf<[]>();

  function invalidCalls() {
    // @ts-expect-error Command arguments come from the installed descriptor.
    editor.commands.toggleFormat('blink');
    // @ts-expect-error Query arguments retain the same formatting vocabulary.
    editor.queries.formatActivity('blink');
    // @ts-expect-error Installing formatting does not imply structural editing commands.
    editor.commands.insertTable();
  }

  void invalidCalls;
  editor.select(new TextSelection({ id: 1, offset: 0 }, { id: 1, offset: 6 }));
  expect(editor.queries.captionFormatAvailable()).toBe(true);
  expectTypeOf(editor.queries.captionFormatAvailable()).toEqualTypeOf<boolean>();
  expect(editor.queries.formatting()).toEqual({ available: true, caret: false });
  expectTypeOf(editor.commands.toggleFormat).parameters.toEqualTypeOf<
    [format: 'bold' | 'italic' | 'underline']
  >();
  expectTypeOf(editor.queries.formatActivity).parameters.toEqualTypeOf<
    [format: 'bold' | 'italic' | 'underline']
  >();
  expect(editor.can().toggleCaptionBold()).toBe(true);
  expect(editor.commands.toggleFormat('bold')).toBe(true);
  expect(editor.getCommandState('toggleCaptionBold').activity).toBe('active');
  expect(editor.commands.clearMarks()).toBe(true);
  expect(editor.getCommandState('toggleCaptionBold').activity).toBe('inactive');
  editor.commands.undo();
  expect(editor.getCommandState('toggleCaptionBold').activity).toBe('active');
  const quote = editor.state.nodes[0];

  if (quote.kind !== 'quote') throw new Error('Expected quote');
  expect(quote.children[0]).toMatchObject({
    kind: 'caption',
    styles: [{ mark: { type: 'bold' } }],
  });
  expect(quote.children[1]).toMatchObject({ kind: 'widget', label: 'Card' });
});

test('starter list and quote commands compose with foreign nodes through schema-bound constructors', () => {
  const editor = createEditor({
    schema,
    content: [
      { kind: 'caption', id: 1, value: 'Custom' },
      { kind: 'widget', id: 2, label: 'Card' },
      { kind: 'paragraph', id: 3, text: 'Standard' },
    ],
  });

  editor.select(new TextSelection({ id: 1, offset: 0 }, { id: 3, offset: 8 }));
  const original = editor.state;
  expect(editor.can().chain().toggleFormat('bold').toggleList(false).toggleQuote().run()).toBe(
    true,
  );
  expect(editor.state).toBe(original);
  expect(editor.chain().toggleFormat('bold').toggleList(false).toggleQuote().run()).toBe(true);
  const quote = editor.state.nodes[0];

  if (quote.kind !== 'quote') throw new Error('Expected quote');
  const list = quote.children[0];

  if (list.kind !== 'list') throw new Error('Expected list');
  expect(list.children.map((item) => item.children[0].kind)).toEqual([
    'caption',
    'widget',
    'paragraph',
  ]);
  expect(list.children[0].children[0]).toMatchObject({
    value: 'Custom',
    styles: [{ mark: { type: 'bold' } }],
  });
  expect(list.children[1].children[0]).toMatchObject({ id: 2, label: 'Card' });
  expect(editor.getCommandState('toggleQuote').activity).toBe('active');
  expect(editor.history.undo).toBe(1);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(original.nodes);
  expect(editor.commands.redo()).toBe(true);
  expect(editor.state.nodes[0]).toEqual(quote);
});

test('heading conversion retains rich text and durable positions in an open schema', () => {
  const editor = createEditor({
    schema,
    content: [
      {
        kind: 'quote',
        id: 10,
        children: [
          { kind: 'caption', id: 1, value: 'Custom' },
          {
            kind: 'paragraph',
            id: 2,
            key: 'rich-text',
            locked: true,
            text: 'Hi \ufffc!',
            marks: [{ from: 0, to: 5, mark: { type: 'italic', attrs: null } }],
            inline: [
              {
                id: 'mention',
                index: 3,
                type: 'mention',
                attrs: { label: 'Ada', width: 30, ascent: 12, descent: 3 },
              },
            ],
          },
        ],
      },
    ],
  });

  editor.select(new NodeSelection(10));
  const original = editor.state;
  const position = editor.positions.at(2, 4);
  expect(editor.can().setHeading(3)).toBe(true);
  expect(editor.state).toBe(original);
  expect(editor.commands.setHeading(3)).toBe(true);
  const quote = editor.state.nodes[0];

  if (quote.kind !== 'quote') throw new Error('Expected quote');
  expect(quote.children[0]).toBe(schema.children(original.nodes[0])[0]);
  expect(quote.children[1]).toMatchObject({
    id: 2,
    key: 'rich-text',
    kind: 'heading',
    level: 3,
    locked: true,
    text: 'Hi \ufffc!',
    marks: [{ from: 0, to: 5, mark: { type: 'italic', attrs: null } }],
    inline: [{ id: 'mention', index: 3, attrs: { label: 'Ada' } }],
  });
  expect(editor.positions.resolve(position)).toMatchObject({
    status: 'resolved',
    point: { id: 2, offset: 4 },
  });
  expect(editor.commands.setHeading(null)).toBe(true);
  expect(editor.state.nodes).toEqual(original.nodes);
  expect(editor.commands.undo()).toBe(true);
  expect(schema.children(editor.state.nodes[0])[1]).toMatchObject({ kind: 'heading', level: 3 });
});

test('table commands preserve custom cell text and cell selections across edits and undo', () => {
  const tableSchema = createSchema({
    extensions: [
      ...starterDefinitions,
      localHistory,
      starterFormatting,
      starterStructure,
      starterTables,
      caption,
      widget,
    ],
  });

  const editor = createEditor({
    schema: tableSchema,
    content: [
      {
        kind: 'table',
        id: 10,
        caption: 'Custom table',
        rows: [
          [
            {
              kind: 'tableCell',
              id: 11,
              row: 0,
              header: true,
              colspan: 1,
              rowspan: 1,
              paragraphs: [{ kind: 'caption', id: 1, value: 'Caption' }],
            },
            {
              kind: 'tableCell',
              id: 12,
              row: 0,
              header: true,
              colspan: 1,
              rowspan: 1,
              paragraphs: [{ kind: 'paragraph', id: 2, text: 'Standard' }],
            },
          ],
        ],
      },
    ],
  });

  const selection = new tableCells.CellSelection(10, 11, 12);
  editor.select(selection);
  const original = editor.state;
  expect(editor.queries.selectedTable()?.id).toBe(10);
  expect(editor.can().chain().toggleFormat('bold').addTableRow().addTableColumn().run()).toBe(true);
  expect(editor.state).toBe(original);
  expect(editor.chain().toggleFormat('bold').addTableRow().addTableColumn().run()).toBe(true);
  const node = editor.state.nodes[0];

  if (node.kind !== 'table') throw new Error('Expected table');
  expect(node.rows.map((row) => row.length)).toEqual([3, 3]);
  expect(node.rows[0][0].paragraphs[0]).toMatchObject({
    kind: 'caption',
    value: 'Caption',
    styles: [{ mark: { type: 'bold' } }],
  });
  expect(node.rows[0][2].header).toBe(true);
  expect(node.rows[1].map((cell) => cell.header)).toEqual([false, false, false]);
  expect(editor.state.selection.eq(selection)).toBe(true);
  expect(editor.history.undo).toBe(1);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(original.nodes);
  editor.select(textSelection(1, 0));
  expect(editor.commands.insertTable()).toBe(true);
  expect(editor.state.nodes.map((item) => item.kind)).toEqual(['table', 'table', 'paragraph']);
  expect(tableSchema.validateDocument(editor.state.nodes).issues).toBeUndefined();
});
