import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import {
  createSchema,
  defineNode,
  defineMark,
  defineInline,
  defineNodeSerializer,
  defineMarkSerializer,
  defineInlineSerializer,
  createDocumentSerializer,
  renderHtml,
  type HtmlOutput,
} from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.object({ value: z.string() }),
    content: { kind: 'text', field: 'value', marks: 'formatting', inline: 'tokens' },
  }),
});

const link = defineMark({
  name: 'link',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.object({ href: z.string() }) }),
});

const token = defineInline(
  {
    name: 'token',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.object({ label: z.string() }) }),
  },
  (attrs) => attrs.label,
);

const schema = createSchema({ extensions: [note, link, token] });

const nodeSerializer = defineNodeSerializer(note, ({ attributes, content }) => {
  expectTypeOf(attributes.value).toEqualTypeOf<string>();

  return { ...content, html: [{ tag: 'article', children: content.html }] };
});

const markSerializer = defineMarkSerializer(link, ({ attributes, content }) => {
  expectTypeOf(attributes.href).toEqualTypeOf<string>();

  return {
    ...content,
    html: [{ tag: 'a', attributes: { href: attributes.href }, children: content.html }],
  };
});

const inlineSerializer = defineInlineSerializer(token, (attributes) => ({
  html: [
    { tag: 'span', attributes: { 'data-token': attributes.label }, children: [attributes.label] },
  ],
  text: attributes.label,
}));

const validated = schema['~standard'].validate([
  {
    kind: 'note',
    value: 'Hi \ufffc!\nNext',
    formatting: [{ from: 0, to: 4, mark: { type: 'link', attrs: { href: '/?q="&' } } }],
    tokens: [{ type: 'token', id: 'one', index: 3, attrs: { label: '<Ada>' } }],
  },
]);

if ('issues' in validated) throw new Error('Invalid serializer fixture');

const document = validated.value;

test('headless static output preserves custom marks and inline semantics with inferred attributes and escaped markup', () => {
  const serializer = createDocumentSerializer(schema, [
    nodeSerializer,
    markSerializer,
    inlineSerializer,
  ]);

  expect(serializer.serialize(document)).toEqual({
    html: '<article><a href="/?q=&quot;&amp;">Hi </a><a href="/?q=&quot;&amp;"><span data-token="&lt;Ada&gt;">&lt;Ada&gt;</span></a>!<br>Next</article>',
    text: 'Hi <Ada>!\nNext',
  });
});

test('missing serializers reject by default and lossy text fallback requires an explicit policy', () => {
  expect(() => createDocumentSerializer(schema, []).serialize(document)).toThrow(
    'Missing serializer: node:note',
  );
  expect(() => createDocumentSerializer(schema, [nodeSerializer]).serialize(document)).toThrow(
    'Missing serializer: mark:link',
  );
  expect(() =>
    createDocumentSerializer(schema, [nodeSerializer, markSerializer]).serialize(document),
  ).toThrow('Missing serializer: inline:token');
  expect(createDocumentSerializer(schema, [], { unsupported: 'text' }).serialize(document)).toEqual(
    { html: '<p>Hi &lt;Ada&gt;!<br>Next</p>', text: 'Hi <Ada>!\nNext' },
  );
  expect(() => createDocumentSerializer(schema, [nodeSerializer, nodeSerializer])).toThrow(
    'Duplicate serializer: node:note',
  );
  expect(() => createDocumentSerializer(schema, [markSerializer, markSerializer])).toThrow(
    'Duplicate serializer: mark:link',
  );
});

test('structured HTML output rejects malformed names, void children and cycles without a DOM', () => {
  expect(
    renderHtml([
      {
        tag: 'input',
        attributes: { disabled: true, hidden: false, title: undefined, value: '<&"' },
      },
    ]),
  ).toBe('<input disabled value="&lt;&amp;&quot;">');
  expect(() => renderHtml([{ tag: 'p onclick=x' }])).toThrow('Invalid HTML tag');
  expect(() => renderHtml([{ tag: 'p', attributes: { 'x="': 'bad' } }])).toThrow(
    'Invalid HTML attribute',
  );
  expect(() => renderHtml([{ tag: 'img', children: ['invalid'] }])).toThrow('Void HTML tag');
  const children: HtmlOutput[] = [];
  const cyclic = { tag: 'div', children };
  cyclic.children.push(cyclic);
  expect(() => renderHtml([cyclic])).toThrow('nesting limit');
  expect(() =>
    createDocumentSerializer(schema, [nodeSerializer]).serialize([...document, ...document]),
  ).toThrow('Duplicate or cyclic node identity');
});
