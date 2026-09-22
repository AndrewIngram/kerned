import { createDocumentSerializer } from '@gprose/model';
import { createHtmlParser } from '@gprose/view';
import { expect, test } from 'vitest';

import { demoSchema } from '../demo-schema';
import { importHtml } from '../html';
import { starterHtmlParsers } from '../html-parsers';
import { starterSerializers } from '../static-serializers';

const parser = createHtmlParser(demoSchema, starterHtmlParsers);

const serializer = createDocumentSerializer(demoSchema, starterSerializers);

test('starter HTML round trips rich tables, lists, headings, images and inline mentions', () => {
  const source =
    '<h4>Title</h4><blockquote><p><strong>Bold</strong> and <em>italic</em></p><ol start="3"><li><p>Item</p><ul><li><p>Nested</p></li></ul></li></ol></blockquote><table><caption>Table</caption><tr><th rowspan="2"><p><u>Header</u></p></th><td><p><span data-gprose-mention="Ada" data-gprose-width="40" data-gprose-ascent="20" data-gprose-descent="4">Ada</span></p></td></tr><tr><td><p>Last</p></td></tr></table><img src="/image.png" alt="A &amp; B">';

  const nodes = parser.parse(source);
  const exported = serializer.serialize(nodes);
  const restored = parser.parse(exported.html);
  expect(serializer.serialize(restored)).toEqual(exported);
  expect(demoSchema.validateDocument(restored).issues).toBeUndefined();
  expect(exported.html).toContain('data-gprose-width="40"');
  expect(exported.html).toContain('<h4>Title</h4>');
  expect(exported.html).toContain('<img src="/image.png" alt="A &amp; B">');
  expect(exported.text).toContain('Ada');
});

test('paragraph images split text, inherited marks survive blocks, and unsafe sources are dropped', () => {
  const nodes = parser.parse(
    '<section style="font-style:italic"><p>Before<img src="/safe.png" alt="Safe">after</p></section><img src="javascript:alert(1)"><img src="http://["><p></p>',
  );

  expect(nodes.map((node) => node.kind)).toEqual(['paragraph', 'image', 'paragraph', 'paragraph']);
  expect(demoSchema.text(nodes[0])).toBe('Before');
  expect(demoSchema.text(nodes[2])).toBe('after');
  expect(demoSchema.editing(nodes[0]).marks?.read(nodes[0])).toMatchObject([
    { mark: { type: 'italic' } },
  ]);
  expect(demoSchema.editing(nodes[2]).marks?.read(nodes[2])).toMatchObject([
    { mark: { type: 'italic' } },
  ]);
});

test('table import handles row groups, empty cells, nested tables and conversion diagnostics', () => {
  const result = importHtml(
    '<table><tbody><tr><th rowspan="0">Header</th><td></td></tr><tr><td><table><tr><td><a href="/x">Nested</a></td></tr></table></td></tr></tbody></table>',
  );

  const table = result.nodes[0];

  if (table.kind !== 'table') throw new Error('Expected table');
  expect(table.rows[0][0].rowspan).toBe(2);
  expect(table.rows[0][1].paragraphs[0].text).toBe('');
  expect(table.rows[1][0].paragraphs[0].text).toBe('Nested');
  expect(result.tables).toBe(1);
  expect(result.conversions).toMatchObject({ links: 1, nestedTables: 1 });
});
