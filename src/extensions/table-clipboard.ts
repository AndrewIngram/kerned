import { indexTree, textContent, type NodeIdentity, type Schema } from '../model';
import { supportsOwnedText } from '../owned-text-support';
import { selectionContext, TextSelection, type EditorState } from '../state';
import { type Step } from '../transform';
import { table as tableDefinition, tableCell, paragraph } from './starter-definitions';
import { tableCells, tableRows } from './table';

/** Copy a logical rectangle rather than a tree slice ordered by the active cell. */
export function copyCellRectangle<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
): N | null {
  const selection = state.selection;

  if (!(selection instanceof tableCells.CellSelection)) return null;

  const context = selectionContext(schema, state.nodes),
    { map, rect } = tableCells.rectangle(context, selection);

  const table = indexTree(schema, state.nodes).byId.get(selection.tableId)?.node;

  const tableType = schema.node(tableDefinition);
  const cellType = schema.node(tableCell);

  if (!table || !tableType.matches(table)) throw new Error('Missing table');
  const rows: N[][] = Array.from({ length: rect.bottom - rect.top }, () => []);

  for (const row of tableRows(schema, table))
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
      const attributes = cellType.read(cell);

      if (!attributes) throw new Error('Expected table cell');
      rows[bounds.top - rect.top].push(
        cellType.create(cell, { ...attributes, row: bounds.top - rect.top }, schema.children(cell)),
      );
    }

  return tableType.create(table, { caption: '' }, rows.flat());
}

export function cellRectangleText<N extends NodeIdentity>(schema: Schema<N>, table: N): string {
  const rows = tableRows(schema, table);
  const cellType = schema.node(tableCell);

  function attributes(node: N) {
    const result = cellType.read(node);

    if (!result) throw new Error('Expected table cell');

    return result;
  }

  const width = rows[0]?.reduce((n, cell) => n + attributes(cell).colspan, 0) ?? 0;

  const occupied = Array.from({ length: rows.length }, () =>
    Array<string | null>(width).fill(null),
  );

  for (let row = 0; row < rows.length; row++) {
    let col = 0;

    for (const cell of rows[row]) {
      const attrs = attributes(cell);

      while (occupied[row][col] !== null && col < width) col++;

      for (let y = row; y < row + attrs.rowspan; y++)
        for (let x = col; x < col + attrs.colspan; x++) occupied[y][x] = '';
      occupied[row][col] = schema
        .children(cell)
        .map((node) => textContent(schema, node))
        .join('\n');
      col += attrs.colspan;
    }
  }

  return occupied.map((row) => row.map((value) => escape(value ?? '')).join('\t')).join('\n');
}

export function cellPasteTarget<N extends NodeIdentity>(schema: Schema<N>, state: EditorState<N>) {
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

  if (
    !cell ||
    !table ||
    !schema.node(tableCell).matches(cell.node) ||
    !schema.node(tableDefinition).matches(table.node)
  )
    return null;

  const map = tableCells.grid(context, table.node.id),
    bounds = map.bounds.get(cell.node.id);

  return bounds ? { tableId: table.node.id, row: bounds.top, column: bounds.left, map } : null;
}

/** Schema-owned rectangular replacement; browser and React adapters only dispatch it. */
export function pasteCellRectangle<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  source: N,
  allocate: () => NodeIdentity,
) {
  const target = cellPasteTarget(schema, state);

  if (!target) return null;

  const tree = indexTree(schema, state.nodes),
    table = tree.byId.get(target.tableId)?.node;

  if (!table || !schema.node(tableDefinition).matches(table))
    throw new Error('Missing destination table');
  const sourceRows = tableRows(schema, source);
  const targetRows = tableRows(schema, table);
  const cells = schema.node(tableCell);
  const paragraphs = schema.node(paragraph);

  function attributes(cell: N) {
    const attrs = cells.read(cell);

    if (!attrs) throw new Error('Expected table cell');

    return attrs;
  }

  if (
    [...sourceRows, ...targetRows].some((row) =>
      row.some((cell) => {
        const attrs = attributes(cell);

        return attrs.colspan !== 1 || attrs.rowspan !== 1;
      }),
    )
  )
    throw new Error('Rectangular paste currently requires tables without merged cells.');

  const width = sourceRows[0]?.length ?? 0,
    height = sourceRows.length;

  if (!width || !height || sourceRows.some((row) => row.length !== width))
    throw new Error('Clipboard table must be rectangular.');

  function clone(node: N): N {
    const text = schema.text(node);

    if (text !== null && !supportsOwnedText(text))
      throw new Error('This study currently supports Latin text and emoji.');

    return schema.copy(node, allocate);
  }

  function empty(row: number, header: boolean): N {
    const identity = allocate();

    return cells.create(identity, { row, header, colspan: 1, rowspan: 1 }, [
      paragraphs.create(allocate(), { text: '' }),
    ]);
  }

  const columns = Math.max(target.map.width, target.column + width),
    rows = Math.max(target.map.height, target.row + height);

  const result = targetRows.map((row) => [...row]),
    steps: Step<N>[] = [];

  for (let y = 0; y < rows; y++) {
    const row = result[y] ?? (result[y] = []);

    for (let x = row.length; x < columns; x++)
      row.push(
        empty(y, y < target.map.height && targetRows[y].every((cell) => attributes(cell).header)),
      );
  }

  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const cell = result[target.row + y][target.column + x],
        content = schema.children(sourceRows[y][x]).map(clone);

      result[target.row + y][target.column + x] = cells.create(
        cell,
        {
          ...attributes(cell),
          header: attributes(sourceRows[y][x]).header,
        },
        content,
      );
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
    const old = targetRows[y]?.length ?? 0,
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
export function plainCellRectangle<N extends NodeIdentity>(
  schema: Schema<N>,
  text: string,
  allocate: () => NodeIdentity,
): N {
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

  const table = schema.node(tableDefinition);
  const cell = schema.node(tableCell);
  const textBlock = schema.node(paragraph);
  const identity = allocate();

  return table.create(
    identity,
    { caption: '' },
    rows.flatMap((row, y) =>
      Array.from({ length: width }, (_, x) => {
        const cellId = allocate();

        return cell.create(cellId, { row: y, header: false, colspan: 1, rowspan: 1 }, [
          textBlock.create(allocate(), { text: row[x] ?? '' }),
        ]);
      }),
    ),
  );
}

const escape = (value: string) =>
  /[\t\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
