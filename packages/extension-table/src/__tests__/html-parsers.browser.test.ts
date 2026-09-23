import { paragraph } from '@kerned/extension-document';
import { table, tableCell } from '@kerned/extension-table';
import { tableHtmlParsers } from '@kerned/extension-table/browser';
import { createSchema } from '@kerned/model';
import { createHtmlParser, defineHtmlTextParser } from '@kerned/view';
import { expect, test } from 'vitest';

test('nested merged tables retain serializer text without requiring unrelated definitions', () => {
  const schema = createSchema({ extensions: [paragraph, table, tableCell] });

  const parser = createHtmlParser(schema, [
    defineHtmlTextParser(paragraph, {
      selector: 'p',
      fallback: true,
      attributes: (_element, text) => ({ text }),
    }),
    ...tableHtmlParsers,
  ]);

  const node = parser.parse(
    '<table><tr><td><table><tr><td colspan="2">A</td></tr><tr><td>B</td><td>C</td></tr></table></td></tr></table>',
  )[0];

  expect(node.kind).toBe('table');

  if (node.kind !== 'table') throw new Error('Expected table');
  expect(node.rows[0][0].paragraphs[0].text).toBe('A\nB\tC');
});
