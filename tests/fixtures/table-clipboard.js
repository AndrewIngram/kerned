export { createEditor, textSelection, selectionContext } from '@gprose/state';

export { indexTree } from '@gprose/model';

export { demoSchema } from '../../src/extensions/demo-schema.ts';

export { createTable, tableCells } from '@gprose/extension-table';

export {
  copyCellRectangle,
  pasteCellRectangle,
  cellRectangleText,
  plainCellRectangle,
} from '@gprose/extension-table';

export { writeClipboard, readClipboard } from '../../src/extensions/clipboard.ts';

export { pasteFragment } from '../../src/extensions/clipboard-fragment.ts';
