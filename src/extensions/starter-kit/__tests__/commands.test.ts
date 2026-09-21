import { expect, test, vi } from 'vitest';

import { createEditor } from '../../../core';
import { createSchema, indexTree } from '../../../model';
import { AllSelection, TextSelection, textSelection } from '../../../state';
import { tableCells } from '../../table';
import { starterExtensions } from '../index';

const schema = createSchema({ extensions: starterExtensions });

function session() {
  return createEditor({
    schema,
    content: [
      { kind: 'paragraph', id: 1, text: 'First' },
      { kind: 'paragraph', id: 2, text: 'Second' },
    ],
  });
}

test('headless starter commands share formatting, heading and quote edits in one transaction', () => {
  const editor = session();
  editor.select(new TextSelection({ id: 1, offset: 0 }, { id: 2, offset: 6 }));
  const initial = editor.state;
  expect(editor.can().chain().toggleFormat('bold').setHeading(2).toggleQuote().run()).toBe(true);
  expect(editor.state).toBe(initial);
  expect(editor.chain().toggleFormat('bold').setHeading(2).toggleQuote().run()).toBe(true);
  expect(editor.history.undo).toBe(1);
  expect(editor.state.nodes).toHaveLength(1);
  const quote = editor.state.nodes[0];

  if (quote.kind !== 'quote') throw new Error('Expected quote');
  expect(quote.children.map((node) => node.kind)).toEqual(['heading', 'heading']);
  expect(quote.children).toMatchObject([
    { level: 2, marks: [{ mark: { type: 'bold' } }] },
    { level: 2, marks: [{ mark: { type: 'bold' } }] },
  ]);
  expect(editor.getCommandState('toggleQuote').activity).toBe('active');
  editor.undo();
  expect(editor.state.nodes.map((node) => node.kind)).toEqual(['paragraph', 'paragraph']);
});

test('stale structural callbacks use the current selection and dry runs do not reserve identities', () => {
  const editor = session();
  const toggle = editor.commands.toggleList;
  expect(editor.can().toggleList(false)).toBe(true);
  editor.select(textSelection(2, 0));
  expect(toggle(false)).toBe(true);
  expect(editor.state.nodes[0].id).toBe(1);
  const list = editor.state.nodes[1];

  if (list.kind !== 'list') throw new Error('Expected list');
  expect(list.children[0].id).toBe(-1);
  expect(list.children[0].children[0].id).toBe(2);
  expect(editor.getCommandState('indentList').available).toBe(false);
  expect(editor.commands.indentList(true)).toBe(true);
  expect(editor.state.nodes.map((node) => node.kind)).toEqual(['paragraph', 'paragraph']);
});

test('table commands work without React and all inserted nodes have unique identities', () => {
  const editor = session();
  expect(editor.can().insertTable()).toBe(true);
  expect(editor.commands.insertTable()).toBe(true);
  const table = editor.state.nodes.find((node) => node.kind === 'table');

  if (!table) throw new Error('Expected table');
  const first = table.rows[0][0].paragraphs[0];
  editor.select(textSelection(first.id, 0));
  expect(editor.queries.selectedTable()?.id).toBe(table.id);
  expect(editor.chain().addTableRow().addTableColumn().run()).toBe(true);
  const next = editor.state.nodes.find((node) => node.kind === 'table');

  if (!next) throw new Error('Expected table');
  expect(next.rows).toHaveLength(table.rows.length + 1);
  expect(next.rows[0]).toHaveLength(table.rows[0].length + 1);
  const tree = indexTree(schema, editor.state.nodes);
  expect(new Set(tree.order.map((entry) => entry.node.key)).size).toBe(tree.order.length);
  expect(new Set(tree.order.map((entry) => entry.node.id)).size).toBe(tree.order.length);
});

test('whole-document toolbar queries resolve selection ranges a bounded number of times', () => {
  const count = 200;

  const editor = createEditor({
    schema,
    content: Array.from({ length: count }, (_, index) => ({
      kind: 'paragraph' as const,
      id: index + 1,
      text: 'A paragraph',
    })),
  });

  const selection = new AllSelection();
  editor.select(selection);
  const ranges = vi.spyOn(selection, 'ranges');
  expect(editor.queries.blockState()).toEqual({ item: undefined, quoted: false });
  expect(ranges.mock.calls.length).toBeLessThanOrEqual(8);
  ranges.mockRestore();
});

test('quoting selected list items wraps their list rather than replacing its item records', () => {
  const editor = session();
  editor.select(new TextSelection({ id: 1, offset: 0 }, { id: 2, offset: 6 }));
  expect(editor.chain().toggleList(false).toggleQuote().run()).toBe(true);
  const quote = editor.state.nodes[0];

  if (quote.kind !== 'quote') throw new Error('Expected quote');
  const list = quote.children[0];

  if (list.kind !== 'list') throw new Error('Expected list');
  expect(list.children.map((item) => item.children[0].id)).toEqual([1, 2]);
  expect(editor.history.undo).toBe(1);
  editor.undo();
  expect(editor.state.nodes.map((node) => node.kind)).toEqual(['paragraph', 'paragraph']);
});

test('heading conversion includes empty cells at both ends of a rectangle', () => {
  const editor = session();
  expect(editor.commands.insertTable()).toBe(true);
  const table = editor.state.nodes.find((node) => node.kind === 'table');

  if (!table) throw new Error('Expected table');
  editor.select(new tableCells.CellSelection(table.id, table.rows[0][0].id, table.rows[1][0].id));
  expect(editor.commands.setHeading(3)).toBe(true);
  const tree = indexTree(schema, editor.state.nodes);
  expect(tree.byId.get(table.rows[0][0].paragraphs[0].id)?.node).toMatchObject({
    kind: 'heading',
    level: 3,
  });
  expect(tree.byId.get(table.rows[1][0].paragraphs[0].id)?.node).toMatchObject({
    kind: 'heading',
    level: 3,
  });
  expect(tree.byId.get(table.rows[0][1].paragraphs[0].id)?.node.kind).toBe('paragraph');
});
