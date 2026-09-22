import { createEditor } from '@gprose/core';
import { createSchema } from '@gprose/model';
import { starterExtensions } from '@gprose/starter-kit';
import { expect, test } from 'vitest';

import { tableCells } from '../table.js';

test('rectangular selection scopes include only selected cells, including their empty text', ({
  onTestFinished,
}) => {
  const editor = createEditor({
    schema: createSchema({ extensions: starterExtensions }),
    content: [
      {
        kind: 'table',
        id: 1,
        caption: '',
        rows: Array.from({ length: 2 }, (_row, row) =>
          Array.from({ length: 2 }, (_, column) => {
            const index = row * 2 + column;

            return {
              kind: 'tableCell' as const,
              id: 10 + index,
              row: Math.floor(index / 2),
              header: false,
              colspan: 1,
              rowspan: 1,
              paragraphs: [
                {
                  kind: 'paragraph' as const,
                  id: 20 + index,
                  text: index === 2 ? '' : `Cell ${index}`,
                },
              ],
            };
          }),
        ),
      },
    ],
  });

  onTestFinished(() => editor.destroy());
  editor.select(new tableCells.CellSelection(1, 10, 12));
  expect(editor.getSelection(11)).toEqual({ kind: 'none' });
  expect(editor.getSelection(13)).toEqual({ kind: 'none' });
  expect(editor.getSelection(12)).toEqual({
    kind: 'range',
    ranges: [{ kind: 'text', id: 22, from: 0, to: 0 }],
  });
  expect(editor.getSelection(22)).toEqual(editor.getSelection(12));
  expect(editor.getSelection(1)).toEqual({
    kind: 'range',
    ranges: [
      { kind: 'text', id: 22, from: 0, to: 0 },
      { kind: 'text', id: 20, from: 0, to: 6 },
    ],
  });
});
