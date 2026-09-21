import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createEditor } from '../../core';
import {
  createSchema,
  defineNode,
  indexTree,
  type DocumentInput,
  type DocumentNode,
} from '../../model';
import { TextSelection, textSelection, NodeSelection } from '../../state';
import type { ClipboardFragment } from '../clipboard';
import { starterExtensions } from '../starter-kit';
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
  extensions: [...starterExtensions, caption, widget],
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
  const fragment = { nodes: [source], inline: true };
  expect(editor.can().paste(fragment)).toBe(true);
  expect(editor.state).toBe(original);
  expect(editor.chain().paste(fragment).run()).toBe(true);
  const destination = editor.state.nodes[1];

  if (destination.kind !== 'caption') throw new Error('Expected caption');
  expect(destination.value).toBe('BeforeA\ufffcAfter');
  expect(destination.styles).toEqual([{ from: 6, to: 8, mark: { type: 'bold', attrs: null } }]);
  expect(destination.tokens[0]).toMatchObject({ index: 7, attrs: { label: 'Ada' } });
  expect(destination.tokens[0].id).not.toBe('source-mention');
  expect(editor.state.nodes[0]).toBe(source);
  expect(editor.history.undo).toBe(1);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(original.nodes);
  expect(editor.commands.redo()).toBe(true);
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
  const fragment = { nodes: [source], inline: false };
  expect(editor.can().paste(fragment)).toBe(true);
  expect(editor.state).toBe(original);
  expect(editor.chain().paste(fragment).run()).toBe(true);
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
  expect(editor.commands.undo()).toBe(true);
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
  expect(editor.commands.replaceSelection('X')).toBe(true);
  expect(editor.state.nodes).toHaveLength(1);
  expect(schema.children(editor.state.nodes[0])).toMatchObject([
    { kind: 'caption', id: 1, value: 'AXZ' },
  ]);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(original.nodes);
});

test('the complete starter kit binds node-valued commands to the consumer document', () => {
  const editor = createEditor({
    schema,
    content: [{ kind: 'widget', id: 1, label: 'Original' }],
  });

  type Node = DocumentNode<typeof schema.definitions>;

  expectTypeOf(editor.commands.updateNode).parameters.toEqualTypeOf<[node: Node]>();
  expectTypeOf(editor.commands.paste).parameters.toEqualTypeOf<
    [fragment: ClipboardFragment<Node>]
  >();
  const node = editor.state.nodes[0];

  if (node.kind !== 'widget') throw new Error('Expected widget');
  const changed = { ...node, label: 'Changed' };
  const initial = editor.state;
  expect(editor.getCommandState('updateNode', changed).available).toBe(true);
  expect(editor.can().chain().updateNode(changed).run()).toBe(true);
  expect(editor.state).toBe(initial);
  expect(editor.chain().updateNode(changed).run()).toBe(true);
  expect(editor.state.nodes[0]).toMatchObject({ label: 'Changed' });
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(initial.nodes);

  editor.select(new NodeSelection(node.id));
  expect(editor.commands.replaceSelection('First\nSecond')).toBe(true);
  expect(editor.state.nodes).toMatchObject([
    { kind: 'paragraph', text: 'First' },
    { kind: 'paragraph', text: 'Second' },
  ]);

  function invalidArguments() {
    const unknownNode = { id: 4, key: 'unknown', kind: 'unknown' } as const;
    // @ts-expect-error Node-valued arguments reject definitions absent from this schema.
    editor.commands.updateNode(unknownNode);
    // @ts-expect-error Fragment descendants use the assembled document union.
    editor.commands.paste({ nodes: [unknownNode], inline: false });
    // @ts-expect-error Chained calls preserve the same argument restrictions.
    editor.chain().updateNode(unknownNode);
    // @ts-expect-error Availability queries do not widen command arguments.
    editor.can().paste({ nodes: [unknownNode], inline: false });
    // @ts-expect-error Activity queries also use the same bound tuple.
    editor.getCommandState('updateNode', unknownNode);
    // @ts-expect-error Known nodes still require their attributes.
    editor.commands.updateNode({ kind: 'widget', id: 4, key: 'missing-label' });
  }

  void invalidArguments;
});
