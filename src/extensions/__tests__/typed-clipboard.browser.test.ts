import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor } from '../../core';
import { createSchema, defineNode } from '../../model';
import { textSelection } from '../../state';
import { readClipboard, writeClipboard } from '../clipboard';
import { starterExtensions } from '../starter-kit';
import { tableCells } from '../table';
import { copyCellRectangle, cellRectangleText } from '../table-clipboard';

const note = defineNode({
  name: 'note',
  version: 1,
  options: { max: 100 },
  schema: (options) => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({
      body: z.string().max(options.max),
      category: z.string().default('note'),
    }),
    content: { kind: 'text', field: 'body', marks: 'styles' },
  }),
});

const schema = createSchema({ extensions: [...starterExtensions, note] });

test('local clipboard preserves custom canonical nodes and cross-schema transfer validates the target definition', ({
  onTestFinished,
}) => {
  const editor = createEditor({
    schema,
    content: [
      {
        kind: 'note',
        id: 1,
        body: 'Custom node',
        category: 'important',
        styles: [{ from: 0, to: 6, mark: { type: 'bold', attrs: null } }],
      },
    ],
    selection: textSelection(1, 0, 11),
  });

  onTestFinished(() => editor.destroy());
  const data = new DataTransfer();
  writeClipboard(data, schema, editor.state, 'Custom node');
  expect(readClipboard(data, schema)?.nodes[0]).toBe(editor.state.nodes[0]);
  expect(data.getData('text/html')).toBe('<p><strong>Custom</strong> node</p>');
  const target = createSchema({ extensions: [...starterExtensions, note] });
  const transferred = readClipboard(data, target);
  expect(transferred?.nodes[0]).toEqual(editor.state.nodes[0]);
  expect(transferred?.nodes[0]).not.toBe(editor.state.nodes[0]);

  const restricted = createSchema({
    extensions: [...starterExtensions, note.configure({ max: 3 })],
  });

  expect(() => readClipboard(data, restricted)).toThrow(/Too big/);
});

test('rectangular copy retains custom cell text nodes and their attributes', ({
  onTestFinished,
}) => {
  const editor = createEditor({
    schema,
    content: [
      {
        kind: 'table',
        id: 1,
        caption: 'Grid',
        rows: [
          [
            {
              kind: 'tableCell',
              id: 2,
              row: 0,
              header: false,
              colspan: 1,
              rowspan: 1,
              paragraphs: [{ kind: 'note', id: 3, body: 'Cell', category: 'custom' }],
            },
          ],
        ],
      },
    ],
    selection: new tableCells.CellSelection(1, 2, 2),
  });

  onTestFinished(() => editor.destroy());
  const copied = copyCellRectangle(schema, editor.state);

  if (!copied) throw new Error('Expected rectangle');
  expect(cellRectangleText(schema, copied)).toBe('Cell');
  const child = schema.children(schema.children(copied)[0])[0];
  expect(child).toMatchObject({ kind: 'note', body: 'Cell', category: 'custom' });
  const data = new DataTransfer();
  writeClipboard(data, schema, editor.state, 'ignored');
  expect(readClipboard(data, schema)?.nodes).toEqual([copied]);
});
