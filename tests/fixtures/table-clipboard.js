export { createEditor, textSelection, selectionContext } from '@gprose/state';

export { indexTree } from '@gprose/model';

export { demoSchema } from '../../src/demo/demo-schema.js';

export { createTable, tableCells } from '@gprose/extension-table';

export {
  copyCellRectangle,
  pasteCellRectangle,
  cellRectangleText,
  plainCellRectangle,
} from '@gprose/extension-table';

export { writeClipboard, readClipboard } from '@gprose/extension-editing/browser';

export { pasteFragment } from '@gprose/extension-editing';
