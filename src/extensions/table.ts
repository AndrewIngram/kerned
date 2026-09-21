import { z } from 'zod';

import type { TableNode } from './demo-model';

/** Plain-text clipboard representation for a read-only table block. */
export function tablePlainText(table: TableNode): string {
  const rows = table.rows.map((row) =>
    row.map((cell) => cell.paragraphs.map((p) => p.text).join('\n')).join('\t'),
  );

  return (table.caption ? [table.caption, ...rows] : rows).join('\n');
}

import type { NodeIdentity } from '../model';
import { createCellSelectionExtension } from './cell-selection';

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

export function createTable(allocate: () => NodeIdentity, rows = 3, columns = 3): TableNode {
  return {
    kind: 'table',
    ...allocate(),
    caption: '',
    rows: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, () => ({
        kind: 'tableCell',
        ...allocate(),
        row,
        header: row === 0,
        colspan: 1,
        rowspan: 1,
        paragraphs: [{ kind: 'paragraph', ...allocate(), text: '', marks: [], inline: [] }],
      })),
    ),
  };
}

export function appendTableRow(table: TableNode, allocate: () => NodeIdentity): TableNode {
  if (table.rows.some((row) => row.some((cell) => cell.colspan !== 1 || cell.rowspan !== 1)))
    throw new Error('Row insertion is currently limited to tables without merged cells');

  const row = table.rows.length,
    columns = table.rows[0]?.length ?? 1;

  const cells = createTable(allocate, 1, columns).rows[0].map((cell) => ({
    ...cell,
    row,
    header: false,
  }));

  return { ...table, rows: [...table.rows, cells] };
}

export function appendTableColumn(table: TableNode, allocate: () => NodeIdentity): TableNode {
  if (table.rows.some((row) => row.some((cell) => cell.colspan !== 1 || cell.rowspan !== 1)))
    throw new Error('Column insertion is currently limited to tables without merged cells');
  const cells = createTable(allocate, table.rows.length, 1).rows;

  return {
    ...table,
    rows: table.rows.map((row, index) => [
      ...row,
      { ...cells[index][0], header: row.every((cell) => cell.header) },
    ]),
  };
}
