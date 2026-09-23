import { createEditor } from '@gprose/core';
import { paragraph } from '@gprose/extension-document';
import { createSchema, indexTree } from '@gprose/model';
import { starterExtensions } from '@gprose/starter-kit';
import { selectionContext, textSelection } from '@gprose/state';
import { expect, onTestFinished, test } from 'vitest';

import { pasteCellRectangle } from '../clipboard.js';
import { table, tableCell } from '../definitions.js';
import { tableCells } from '../table.js';

const schema = createSchema({ extensions: starterExtensions });

function fixture(mergeBelow = false) {
  let next = 1;
  const allocate = () => ({ id: next++, key: crypto.randomUUID() });

  const cell = (row: number, text: string, colspan = 1, rowspan = 1) =>
    schema
      .node(tableCell)
      .create(allocate(), { row, header: false, colspan, rowspan }, [
        schema.node(paragraph).create(allocate(), { text }),
      ]);

  const merged = cell(mergeBelow ? 1 : 0, 'Preserved merge', 2, 2);

  const rows = mergeBelow
    ? [
        Array.from({ length: 4 }, (_, x) => cell(0, `0:${x}`)),
        [merged, cell(1, '1:2'), cell(1, '1:3')],
        [cell(2, '2:2'), cell(2, '2:3')],
      ]
    : [
        [merged, cell(0, '0:2'), cell(0, '0:3')],
        [cell(1, '1:2'), cell(1, '1:3')],
        Array.from({ length: 4 }, (_, x) => cell(2, `2:${x}`)),
      ];

  const original = schema.node(table).create(allocate(), { caption: '' }, rows.flat());
  let blocked: number | undefined;

  const editor = createEditor({
    schema,
    document: [original],
    permissions: {
      access: (node) => (node.id === merged.id || node.id === blocked ? 'read-only' : 'editable'),
    },
  });

  const source = (height: number, width: number) =>
    schema
      .node(table)
      .create(
        allocate(),
        { caption: '' },
        Array.from({ length: height }, (_row, y) =>
          Array.from({ length: width }, (_column, x) => cell(y, `Pasted ${y}:${x}`)),
        ).flat(),
      );

  const grid = () => tableCells.grid(selectionContext(schema, editor.state.nodes), original.id);

  const idAt = (y: number, x: number) => {
    const map = grid();

    return map.cells[map.slots[y * map.width + x]].id;
  };

  return {
    editor,
    original,
    merged,
    rows,
    allocate,
    source,
    grid,
    idAt,
    block(id: number) {
      blocked = id;
    },
  };
}

test.each([
  { row: 1, column: 2, height: 2, width: 2, expected: [3, 4] },
  { row: 1, column: 2, height: 3, width: 3, expected: [4, 5] },
  { row: 2, column: 0, height: 1, width: 2, expected: [3, 4] },
])(
  'paste at $row,$column preserves unrelated spans and grows to $expected',
  ({ row, column, height, width, expected }) => {
    const f = fixture();
    onTestFinished(() => f.editor.destroy());
    const before = f.editor.state.nodes;
    const beforeTree = indexTree(schema, before);
    const first = f.idAt(row, column);
    f.editor.select(new tableCells.CellSelection(f.original.id, first));
    const command = pasteCellRectangle(schema, f.editor.state, f.source(height, width), f.allocate);
    expect(command).not.toBeNull();

    if (!command) throw new Error('Expected cell paste');
    f.editor.dispatch({
      baseRevision: 0,
      origin: 'local',
      history: 'separate',
      time: 0,
      ...command,
    });
    const pasted = f.editor.state.nodes;
    const map = f.grid();
    const tree = indexTree(schema, pasted);
    expect([map.height, map.width]).toEqual(expected);
    expect(f.idAt(row, column)).toBe(first);
    expect(tree.byId.get(f.merged.id)?.node).toBe(beforeTree.byId.get(f.merged.id)?.node);
    expect(tree.byId.get(f.rows[0][1].id)?.node).toBe(beforeTree.byId.get(f.rows[0][1].id)?.node);
    expect(map.bounds.get(f.merged.id)).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });

    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const entry = tree.byId.get(f.idAt(row + y, column + x));

        if (!entry) throw new Error('Missing pasted cell');
        expect(schema.text(schema.children(entry.node)[0])).toBe(`Pasted ${y}:${x}`);
      }

    expect(f.editor.state.selection).toEqual(
      new tableCells.CellSelection(
        f.original.id,
        first,
        f.idAt(row + height - 1, column + width - 1),
      ),
    );
    expect(tree.byId.size).toBe(tree.byKey.size);
    expect(f.editor.history.undo).toBe(1);
    expect(f.editor.commands.undo()).toBe(true);
    expect(f.editor.state.nodes).toEqual(before);
    expect(f.editor.commands.redo()).toBe(true);
    expect(f.editor.state.nodes).toEqual(pasted);
  },
);

test('native cell caret paste beside a rowspan checks access atomically', () => {
  const f = fixture();
  onTestFinished(() => f.editor.destroy());
  f.editor.select(textSelection(schema.children(f.rows[1][0])[0].id, 0));
  const source = f.source(1, 2);
  const command = pasteCellRectangle(schema, f.editor.state, source, f.allocate);

  if (!command) throw new Error('Expected native caret target');
  const before = f.editor.state;
  f.block(f.rows[1][1].id);
  expect(() =>
    f.editor.dispatch({
      baseRevision: 0,
      origin: 'local',
      history: 'separate',
      time: 0,
      ...command,
    }),
  ).toThrow('Permission denied');
  expect(f.editor.state).toBe(before);
  expect(f.editor.history.undo).toBe(0);
});

test('paste rejects a merged cell later in the rectangle, before allocating any content', () => {
  const f = fixture(true);
  onTestFinished(() => f.editor.destroy());
  const source = f.source(2, 2);
  f.editor.select(new tableCells.CellSelection(f.original.id, f.idAt(0, 0)));
  const before = f.editor.state;
  expect(() =>
    pasteCellRectangle(schema, before, source, () => {
      throw new Error('Unexpected allocation');
    }),
  ).toThrow('cannot overwrite merged cells');
  expect(f.editor.state).toBe(before);
  expect(f.editor.history.undo).toBe(0);
});

test('merged sources and destinations reject before allocating or editing content', () => {
  const f = fixture();
  onTestFinished(() => f.editor.destroy());
  const source = f.source(1, 1);

  const allocate = () => {
    throw new Error('Unexpected allocation');
  };

  f.editor.select(new tableCells.CellSelection(f.original.id, f.rows[1][0].id));
  const before = f.editor.state;
  expect(() => pasteCellRectangle(schema, before, f.original, allocate)).toThrow(
    'source without merged cells',
  );
  f.editor.select(new tableCells.CellSelection(f.original.id, f.merged.id));
  expect(() => pasteCellRectangle(schema, f.editor.state, source, allocate)).toThrow(
    'cannot overwrite merged cells',
  );
  expect(f.editor.state.nodes).toBe(before.nodes);
  expect(f.editor.history.undo).toBe(0);
});
