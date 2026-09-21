export { createEditor, textSelection, selectionContext } from '../../src/state/index.ts';

export { indexTree } from '../../src/model/index.ts';

export { demoSchema } from '../../src/extensions/demo-schema.ts';

export { createTable, tableCells } from '../../src/extensions/table.ts';

export {
  copyCellRectangle,
  pasteCellRectangle,
  cellRectangleText,
  plainCellRectangle,
} from '../../src/extensions/table-clipboard.ts';

export { writeClipboard, readClipboard, pasteFragment } from '../../src/extensions/clipboard.ts';
