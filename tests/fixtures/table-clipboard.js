export { createEditor, textSelection, selectionContext } from '@kerned/state';

export { indexTree } from '@kerned/model';

export { demoSchema } from '../../apps/demo/src/demo-schema.js';

export { createTable, tableCells } from '@kerned/extension-table';

export {
  copyCellRectangle,
  pasteCellRectangle,
  cellRectangleText,
  plainCellRectangle,
} from '@kerned/extension-table';

export { writeClipboard, readClipboard } from '@kerned/extension-editing/browser';

export { pasteFragment } from '@kerned/extension-editing';
