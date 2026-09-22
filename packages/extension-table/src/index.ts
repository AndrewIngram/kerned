export { table, tableCell } from './definitions.js';

export { tableEditing } from './commands.js';

export {
  createCellSelectionExtension,
  type TableSelectionAdapter,
  type GridCell,
} from './selection.js';

export { tableCells, createTable, tableRows, appendTableRow, appendTableColumn } from './table.js';

export {
  copyCellRectangle,
  pasteCellRectangle,
  plainCellRectangle,
  cellRectangleText,
  cellPasteTarget,
} from './clipboard.js';

export { tableSerializers } from './serialization.js';
