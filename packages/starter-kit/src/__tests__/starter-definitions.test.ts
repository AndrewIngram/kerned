import { paragraph, quote } from '@gprose/extension-document';
import { table, tableCell } from '@gprose/extension-table';
import { createSchema } from '@gprose/model';
import { expect, test } from 'vitest';

test('blockquote works with a minimal text kit without tables, lists or images', () => {
  const schema = createSchema({ extensions: [paragraph, quote, table, tableCell] });

  const result = schema['~standard'].validate([
    { kind: 'quote', children: [{ kind: 'paragraph', text: 'A small editor.' }] },
  ]);

  if (result.issues) throw new Error(JSON.stringify(result.issues));
  expect(schema.text(schema.children(result.value[0])[0])).toBe('A small editor.');
});

test('table cells accept installed text blocks without requiring headings', () => {
  const schema = createSchema({ extensions: [paragraph, table, tableCell] });

  const result = schema['~standard'].validate([
    {
      kind: 'table',
      caption: '',
      rows: [
        [
          {
            kind: 'tableCell',
            row: 0,
            header: false,
            colspan: 1,
            rowspan: 1,
            paragraphs: [{ kind: 'paragraph', text: 'Cell' }],
          },
        ],
      ],
    },
  ]);

  if (result.issues) throw new Error(JSON.stringify(result.issues));
  const cells = schema.children(result.value[0]);
  expect(schema.text(schema.children(cells[0])[0])).toBe('Cell');
});
