import { type NodeIdentity, type Schema, type MarkRange } from '@gprose/model';

import { table, tableCell } from '../starter-definitions';
import { tableRows } from '../table';

export type TableText = {
  id: number;
  text: string;
  marks: readonly MarkRange[];
};

export type TableCellContent = {
  id: number;
  header: boolean;
  colspan: number;
  rowspan: number;
  paragraphs: readonly TableText[];
};

/** Read a table through installed definitions without changing its canonical nodes.
 * Immutable text snapshots keep unchanged cell DOM and native inputs resident.
 */
export function createTableContent<N extends NodeIdentity>(schema: Schema<N>) {
  const tables = schema.node(table);
  const cells = schema.node(tableCell);
  const textCache = new WeakMap<N, TableText>();
  const cellCache = new WeakMap<N, TableCellContent>();
  const tableCache = new WeakMap<N, { id: number; caption: string; rows: TableCellContent[][] }>();

  function text(node: N): TableText {
    let value = textCache.get(node);

    if (!value) {
      const editing = schema.editing(node);
      value = {
        id: node.id,
        text: editing.text(node),
        marks: editing.marks?.read(node) ?? [],
      };
      textCache.set(node, value);
    }

    return value;
  }

  function cell(node: N): TableCellContent {
    let value = cellCache.get(node);

    if (!value) {
      const attributes = cells.read(node);

      if (!attributes) throw new Error('Expected table cell');
      value = { id: node.id, ...attributes, paragraphs: schema.children(node).map(text) };
      cellCache.set(node, value);
    }

    return value;
  }

  return (node: N) => {
    let value = tableCache.get(node);

    if (!value) {
      const attributes = tables.read(node);

      if (!attributes) throw new Error('Expected table');
      value = {
        id: node.id,
        caption: attributes.caption,
        rows: tableRows(schema, node).map((row) => row.map(cell)),
      };
      tableCache.set(node, value);
    }

    return value;
  };
}
