import { paragraph } from '@kerned/extension-document';
import type { NodeIdentity, Schema } from '@kerned/model';
import { z } from 'zod';

import { table as tableDefinition, tableCell } from './definitions.js';
import { createCellSelectionExtension } from './selection.js';

const cellCoordinates = z.object({
  row: z.number().int().nonnegative(),
  colspan: z.number().int().positive(),
  rowspan: z.number().int().positive(),
});

export const tableCells = createCellSelectionExtension({
  rows(context, id) {
    const node = context.node(id);

    if (!node || !('kind' in node) || node.kind !== 'table') return null;

    // The adapter only reads cells registered in the same schema tree.
    return context
      .children(id)
      .reduce<{ id: number; colspan: number; rowspan: number }[][]>((rows, cell) => {
        const parsed = cellCoordinates.safeParse(cell);

        if (parsed.success) {
          const data = parsed.data;
          (rows[data.row] ??= []).push({
            id: cell.id,
            colspan: data.colspan,
            rowspan: data.rowspan,
          });
        }

        return rows;
      }, []);
  },
});

/** Constructors bind to the consumer's installed schema and retain foreign cell content. */
export function createTable<N extends NodeIdentity>(
  schema: Schema<N>,
  allocate: () => NodeIdentity,
  rows = 3,
  columns = 3,
): N {
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows < 1 || columns < 1)
    throw new Error('Table dimensions must be positive integers');
  const type = schema.node(tableDefinition);
  const identity = allocate();

  const cells = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, () => createCell(schema, allocate, row, row === 0)),
  ).flat();

  return type.create(identity, { caption: '' }, cells);
}

function createCell<N extends NodeIdentity>(
  schema: Schema<N>,
  allocate: () => NodeIdentity,
  row: number,
  header: boolean,
): N {
  const identity = allocate();
  const text = schema.node(paragraph).create(allocate(), { text: '' });

  return schema.node(tableCell).create(identity, { row, header, colspan: 1, rowspan: 1 }, [text]);
}

export function tableRows<N extends NodeIdentity>(schema: Schema<N>, table: N): readonly N[][] {
  if (!schema.node(tableDefinition).matches(table)) throw new Error('Expected table');
  const cells = schema.node(tableCell);
  const rows: N[][] = [];

  for (const node of schema.children(table)) {
    const attrs = cells.read(node);

    if (!attrs) throw new Error('Expected table cell');

    (rows[attrs.row] ??= []).push(node);
  }

  return rows;
}

function unmergedRows<N extends NodeIdentity>(schema: Schema<N>, table: N) {
  const rows = tableRows(schema, table);
  const cells = schema.node(tableCell);

  if (
    rows.some((row) =>
      row.some((cell) => {
        const attrs = cells.read(cell);

        return attrs?.colspan !== 1 || attrs.rowspan !== 1;
      }),
    )
  )
    throw new Error('Row and column insertion is currently limited to tables without merged cells');

  return rows;
}

export function appendTableRow<N extends NodeIdentity>(
  schema: Schema<N>,
  table: N,
  allocate: () => NodeIdentity,
): N {
  const rows = unmergedRows(schema, table);

  const cells = Array.from({ length: rows[0]?.length ?? 1 }, () =>
    createCell(schema, allocate, rows.length, false),
  );

  return schema.withChildren(table, [...rows.flat(), ...cells]);
}

export function appendTableColumn<N extends NodeIdentity>(
  schema: Schema<N>,
  table: N,
  allocate: () => NodeIdentity,
): N {
  const rows = unmergedRows(schema, table);
  const cells = schema.node(tableCell);

  return schema.withChildren(
    table,
    rows.flatMap((row, index) => [
      ...row,
      createCell(
        schema,
        allocate,
        index,
        row.every((cell) => cells.read(cell)?.header),
      ),
    ]),
  );
}
