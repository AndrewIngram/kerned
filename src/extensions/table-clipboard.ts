import {
  indexTree,
  selectionContext,
  TextSelection,
  type EditorState,
  type NodeIdentity,
  type Schema,
  type Step,
} from '../editor';
import { supportsOwnedText } from '../owned-text-support';
import {
  plainText,
  type StarterNode,
  type TableNode,
  type TableCell,
  type TextBlockNode,
} from './demo-model';
import { tableCells } from './table';

/** Copy a logical rectangle rather than a tree slice ordered by the active cell. */
export function copyCellRectangle(
  schema: Schema<StarterNode>,
  state: EditorState<StarterNode>,
): TableNode | null {
  const selection = state.selection;

  if (!(selection instanceof tableCells.CellSelection)) return null;

  const context = selectionContext(schema, state.nodes),
    { map, rect } = tableCells.rectangle(context, selection);

  const table = indexTree(schema, state.nodes).byId.get(selection.tableId)?.node;

  if (table?.kind !== 'table') throw new Error('Missing table');
  const rows: TableCell[][] = Array.from({ length: rect.bottom - rect.top }, () => []);

  for (const row of table.rows)
    for (const cell of row) {
      const bounds = map.bounds.get(cell.id);

      if (
        !bounds ||
        bounds.right <= rect.left ||
        bounds.left >= rect.right ||
        bounds.bottom <= rect.top ||
        bounds.top >= rect.bottom
      )
        continue;

      if (
        bounds.left < rect.left ||
        bounds.right > rect.right ||
        bounds.top < rect.top ||
        bounds.bottom > rect.bottom
      )
        throw new Error('Select complete merged cells before copying.');
      rows[bounds.top - rect.top].push({ ...cell, row: bounds.top - rect.top });
    }

  return { ...table, caption: '', rows };
}

export function cellRectangleText(table: TableNode): string {
  const width = table.rows[0]?.reduce((n, c) => n + c.colspan, 0) ?? 0;

  const occupied = Array.from({ length: table.rows.length }, () =>
    Array<string | null>(width).fill(null),
  );

  for (let row = 0; row < table.rows.length; row++) {
    let col = 0;

    for (const cell of table.rows[row]) {
      while (occupied[row][col] !== null && col < width) col++;

      for (let y = row; y < row + cell.rowspan; y++)
        for (let x = col; x < col + cell.colspan; x++) occupied[y][x] = '';
      occupied[row][col] = cell.paragraphs.map((p) => plainText(p)).join('\n');
      col += cell.colspan;
    }
  }

  return occupied.map((row) => row.map((value) => escape(value ?? '')).join('\t')).join('\n');
}

export function cellPasteTarget(schema: Schema<StarterNode>, state: EditorState<StarterNode>) {
  const context = selectionContext(schema, state.nodes),
    selection = state.selection;

  if (selection instanceof tableCells.CellSelection) {
    const { map, rect } = tableCells.rectangle(context, selection);

    return { tableId: selection.tableId, row: rect.top, column: rect.left, map };
  }

  if (!(selection instanceof TextSelection) || selection.anchor.id !== selection.head.id)
    return null;

  const tree = indexTree(schema, state.nodes),
    entry = tree.byId.get(selection.head.id);

  const cell =
    entry?.parent === null || entry?.parent === undefined ? undefined : tree.byId.get(entry.parent);

  const table =
    cell?.parent === null || cell?.parent === undefined ? undefined : tree.byId.get(cell.parent);

  if (cell?.node.kind !== 'tableCell' || table?.node.kind !== 'table') return null;

  const map = tableCells.grid(context, table.node.id),
    bounds = map.bounds.get(cell.node.id);

  return bounds ? { tableId: table.node.id, row: bounds.top, column: bounds.left, map } : null;
}

/** Schema-owned rectangular replacement; browser and React adapters only dispatch it. */
export function pasteCellRectangle(
  schema: Schema<StarterNode>,
  state: EditorState<StarterNode>,
  source: TableNode,
  allocate: () => NodeIdentity,
) {
  const target = cellPasteTarget(schema, state);

  if (!target) return null;

  const tree = indexTree(schema, state.nodes),
    table = tree.byId.get(target.tableId)?.node;

  if (table?.kind !== 'table') throw new Error('Missing destination table');

  if (
    source.rows.some((row) => row.some((cell) => cell.colspan !== 1 || cell.rowspan !== 1)) ||
    table.rows.some((row) => row.some((cell) => cell.colspan !== 1 || cell.rowspan !== 1))
  )
    throw new Error('Rectangular paste currently requires tables without merged cells.');

  const width = source.rows[0]?.length ?? 0,
    height = source.rows.length;

  if (!width || !height || source.rows.some((row) => row.length !== width))
    throw new Error('Clipboard table must be rectangular.');

  function clone(paragraph: TextBlockNode): TextBlockNode {
    if (!supportsOwnedText(paragraph.text))
      throw new Error('This study currently supports Latin text and emoji.');

    return {
      ...paragraph,
      ...allocate(),
      inline: paragraph.inline.map((value) => ({ ...value, id: crypto.randomUUID() })),
    };
  }

  function empty(row: number, header: boolean): TableCell {
    return {
      kind: 'tableCell',
      ...allocate(),
      row,
      header,
      colspan: 1,
      rowspan: 1,
      paragraphs: [{ kind: 'paragraph', ...allocate(), text: '', marks: [], inline: [] }],
    };
  }

  const columns = Math.max(target.map.width, target.column + width),
    rows = Math.max(target.map.height, target.row + height);

  const result: TableCell[][] = table.rows.map((row) => [...row]),
    steps: Step<StarterNode>[] = [];

  for (let y = 0; y < rows; y++) {
    const row = result[y] ?? (result[y] = []);

    for (let x = row.length; x < columns; x++)
      row.push(empty(y, y < target.map.height && table.rows[y].every((cell) => cell.header)));
  }

  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const cell = result[target.row + y][target.column + x],
        content = source.rows[y][x].paragraphs.map(clone);

      result[target.row + y][target.column + x] = {
        ...cell,
        header: source.rows[y][x].header,
        paragraphs: content,
      };
    }

  // Replace only the affected row slices, retaining destination cell identities.
  for (let y = target.row; y < Math.min(target.row + height, target.map.height); y++) {
    const count = Math.min(width, target.map.width - target.column);
    steps.push({
      kind: 'replaceChildren',
      parent: table.id,
      index: y * target.map.width + target.column,
      count,
      nodes: result[y].slice(target.column, target.column + count),
    });
  }

  // Insert new cells in descending flat-tree order so existing row indexes stay valid.
  for (let y = rows - 1; y >= 0; y--) {
    const old = table.rows[y]?.length ?? 0,
      added = result[y].slice(old);

    if (added.length)
      steps.push({
        kind: 'insertChildren',
        parent: table.id,
        index:
          y < target.map.height ? (y + 1) * target.map.width : target.map.width * target.map.height,
        nodes: added,
      });
  }

  return {
    steps,
    selection: new tableCells.CellSelection(
      table.id,
      result[target.row][target.column].id,
      result[target.row + height - 1][target.column + width - 1].id,
    ),
  };
}

/** Parse spreadsheet TSV, including quoted tabs, newlines and doubled quotes. */
export function plainCellRectangle(text: string, allocate: () => NodeIdentity): TableNode {
  const rows: string[][] = [[]];

  let value = '',
    quoted = false,
    atStart = true;

  const source = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          value += '"';
          i++;
        } else quoted = false;
      } else value += char;
      continue;
    }

    if (char === '"' && atStart) {
      quoted = true;
      atStart = false;
      continue;
    }

    if (char === '\t' || char === '\n') {
      rows[rows.length - 1].push(value);
      value = '';
      atStart = true;

      if (char === '\n' && i < source.length - 1) rows.push([]);
    } else {
      value += char;
      atStart = false;
    }
  }

  if (quoted) throw new Error('Clipboard contains an unterminated quoted cell.');

  if (!source.endsWith('\n') || value) rows[rows.length - 1].push(value);
  const width = rows.reduce((width, row) => Math.max(width, row.length), 0);

  return {
    kind: 'table',
    ...allocate(),
    caption: '',
    rows: rows.map((row, y) =>
      Array.from({ length: width }, (_, x) => ({
        kind: 'tableCell',
        ...allocate(),
        row: y,
        header: false,
        colspan: 1,
        rowspan: 1,
        paragraphs: [
          { kind: 'paragraph', ...allocate(), text: row[x] ?? '', marks: [], inline: [] },
        ],
      })),
    ),
  };
}

const escape = (value: string) =>
  /[\t\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
