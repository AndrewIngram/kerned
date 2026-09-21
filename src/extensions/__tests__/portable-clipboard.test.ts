import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor } from '../../core';
import { createSchema, defineNode, indexTree, type DocumentInput } from '../../model';
import { TextSelection, textSelection } from '../../state';
import { replaceStructuredText } from '../blocks';
import { pasteFragment } from '../clipboard';
import { starterDefinitions } from '../starter-definitions';
import { starterTables } from '../starter-kit/tables';
import { tableCells } from '../table';

const caption = defineNode({
  name: 'caption',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({ value: z.string() }),
    content: { kind: 'text', field: 'value', marks: 'styles', inline: 'tokens' },
  }),
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
  extensions: [...starterDefinitions, starterTables, caption, widget],
});

const richCaption = {
  kind: 'caption',
  id: 1,
  key: 'source',
  value: 'A\ufffc',
  styles: [{ from: 0, to: 2, mark: { type: 'bold', attrs: null } }],
  tokens: [
    {
      id: 'source-mention',
      index: 1,
      type: 'mention',
      attrs: { label: 'Ada', width: 30, ascent: 12, descent: 3 },
    },
  ],
} satisfies DocumentInput<typeof schema.definitions>[number];

test('inline paste uses custom text storage, renews inline identities and undoes atomically', () => {
  const editor = createEditor({
    schema,
    content: [richCaption, { kind: 'caption', id: 2, value: 'BeforeAfter' }],
  });

  const source = editor.state.nodes[0];
  editor.select(textSelection(2, 6));
  const original = editor.state;
  expect(
    editor.transact((context) => {
      const change = pasteFragment(
        context.schema,
        context.state,
        { nodes: [source], inline: true },
        context.allocate,
      );

      context.apply(change);

      return true;
    }),
  ).toBe(true);
  const destination = editor.state.nodes[1];

  if (destination.kind !== 'caption') throw new Error('Expected caption');
  expect(destination.value).toBe('BeforeA\ufffcAfter');
  expect(destination.styles).toEqual([{ from: 6, to: 8, mark: { type: 'bold', attrs: null } }]);
  expect(destination.tokens[0]).toMatchObject({ index: 7, attrs: { label: 'Ada' } });
  expect(destination.tokens[0].id).not.toBe('source-mention');
  expect(editor.state.nodes[0]).toBe(source);
  expect(editor.history.undo).toBe(1);
  expect(editor.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(original.nodes);
  expect(editor.redo()).toBe(true);
  expect(editor.state.nodes[1]).toEqual(destination);
});

test('rectangular paste retains custom cell content while growing the destination table', () => {
  const editor = createEditor({
    schema,
    content: [
      {
        kind: 'table',
        id: 10,
        caption: 'Source',
        rows: [
          [
            {
              kind: 'tableCell',
              id: 11,
              row: 0,
              header: true,
              colspan: 1,
              rowspan: 1,
              paragraphs: [richCaption],
            },
            {
              kind: 'tableCell',
              id: 12,
              row: 0,
              header: false,
              colspan: 1,
              rowspan: 1,
              paragraphs: [{ kind: 'caption', id: 2, value: 'Second' }],
            },
          ],
        ],
      },
      {
        kind: 'table',
        id: 20,
        caption: 'Destination',
        rows: [
          [
            {
              kind: 'tableCell',
              id: 21,
              key: 'destination-cell',
              row: 0,
              header: false,
              colspan: 1,
              rowspan: 1,
              paragraphs: [{ kind: 'paragraph', id: 3, text: 'Replace' }],
            },
          ],
        ],
      },
    ],
  });

  const source = editor.state.nodes[0];
  editor.select(new tableCells.CellSelection(20, 21));
  const original = editor.state;
  expect(
    editor.transact((context) => {
      const change = pasteFragment(
        context.schema,
        context.state,
        { nodes: [source], inline: false },
        context.allocate,
      );

      context.apply(change);

      return true;
    }),
  ).toBe(true);
  const destination = editor.state.nodes[1];

  if (destination.kind !== 'table') throw new Error('Expected table');
  expect(destination.rows[0]).toHaveLength(2);
  expect(destination.rows[0][0]).toMatchObject({ id: 21, key: 'destination-cell', header: true });
  const copied = destination.rows[0][0].paragraphs[0];

  if (copied.kind !== 'caption') throw new Error('Expected caption');
  expect(copied.value).toBe(richCaption.value);
  expect(copied.styles).toEqual(richCaption.styles);
  expect(copied.tokens[0].id).not.toBe(richCaption.tokens[0].id);
  expect(destination.rows[0][1].paragraphs[0]).toMatchObject({ kind: 'caption', value: 'Second' });
  expect(editor.state.nodes[0]).toBe(source);
  const tree = indexTree(schema, editor.state.nodes);
  expect(new Set(tree.order.map((entry) => entry.node.key)).size).toBe(tree.order.length);
  expect(editor.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(original.nodes);
});

test('cross-container replacement works with custom text and intervening atoms', () => {
  const editor = createEditor({
    schema,
    content: [
      { kind: 'quote', id: 10, children: [{ kind: 'caption', id: 1, value: 'Astart' }] },
      { kind: 'widget', id: 2, label: 'Card' },
      { kind: 'quote', id: 20, children: [{ kind: 'paragraph', id: 3, text: 'endZ' }] },
    ],
  });

  editor.select(new TextSelection({ id: 1, offset: 1 }, { id: 3, offset: 3 }));
  const original = editor.state;
  expect(
    editor.transact((context) => {
      const change = replaceStructuredText(context.schema, context.state, 'X');
      context.apply(change);

      return true;
    }),
  ).toBe(true);
  expect(editor.state.nodes).toHaveLength(1);
  expect(schema.children(editor.state.nodes[0])).toMatchObject([
    { kind: 'caption', id: 1, value: 'AXZ' },
  ]);
  expect(editor.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(original.nodes);
});
