import { createEditor, defineExtension, type ContributionContext } from '@gprose/core';
import { createSchema, defineNode, defineMark, defineInline } from '@gprose/model';
import { expect, test } from 'vitest';
import { z } from 'zod';

import {
  createHtmlParser,
  createEditorHtmlParser,
  htmlParsers,
  defineHtmlTextParser,
  defineHtmlNodeParser,
  defineHtmlValueParser,
} from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ value: z.string(), label: z.string() }),
    content: { kind: 'text', field: 'value', marks: 'formatting', inline: 'tokens' },
  }),
});

const group = defineNode({
  name: 'group',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({}),
    content: { kind: 'container', field: 'body', allowed: ['note', 'group'] },
  }),
});

const link = defineMark({
  name: 'link',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ href: z.string() }),
  }),
});

const token = defineInline(
  {
    name: 'token',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ label: z.string() }),
    }),
  },
  (attrs) => attrs.label,
);

const definitions = [note, group, link, token] as const;

const schema = createSchema({ extensions: definitions });

const rules = [
  defineHtmlTextParser(note, {
    selector: 'p, h1',
    fallback: true,
    attributes: (element, value) => ({ value, label: element?.tagName ?? 'text' }),
  }),
  defineHtmlNodeParser(group, { selector: 'section', attributes: () => ({}) }),
  defineHtmlValueParser(link, {
    selector: 'a[href]',
    attributes: (element) => ({ href: element.getAttribute('href')! }),
  }),
  defineHtmlValueParser(token, {
    selector: '[data-token]',
    attributes: (element) => ({ label: element.getAttribute('data-token')! }),
  }),
];

test('HTML rules create custom nested content, marks and inline values without storage knowledge', () => {
  const parser = createHtmlParser(schema, rules);

  const nodes = parser.parse(
    '<section><h1>Title</h1><p>Hi <a href="/ada"><span data-token="Ada">ignored label</span>!</a></p></section>',
  );

  expect(schema.validateDocument(nodes).issues).toBeUndefined();
  const children = schema.children(nodes[0]);
  expect(schema.node(note).read(children[0])).toEqual({ value: 'Title', label: 'H1' });
  expect(schema.node(note).read(children[1])).toEqual({ value: 'Hi \ufffc!', label: 'P' });
  expect(schema.editing(children[1]).marks?.read(children[1])).toEqual([
    { from: 3, to: 5, mark: { type: 'link', attrs: { href: '/ada' } } },
  ]);
  expect(schema.editing(children[1]).inline?.read(children[1])).toMatchObject([
    { index: 3, type: 'token', attrs: { label: 'Ada' } },
  ]);
  expect(parser.parse('<p>Again</p>')[0].key).toBe('html-1');
});

test('unknown blocks retain text, unsafe subtrees disappear, and markup cannot split graphemes', () => {
  const parser = createHtmlParser(schema, rules);

  const nodes = parser.parse(
    '<div> first <i>part</i><script>bad()</script><svg><text>bad vector text</text></svg><math><mi>bad math</mi></math></div><p><a href="/x">e</a>\u0301 &amp; more<br>next \ufffc</p>',
  );

  expect(nodes.map((node) => schema.text(node))).toEqual([
    'first part',
    'e\u0301 & more\nnext \ufffd',
  ]);
  expect(schema.editing(nodes[1]).marks?.read(nodes[1])).toMatchObject([{ from: 0, to: 2 }]);
});

test('higher priority rules get first refusal and ties retain installation order', () => {
  const preferred = defineHtmlNodeParser(group, {
    selector: 'section',
    priority: 100,
    attributes: (element) => (element.hasAttribute('data-group') ? {} : false),
  });

  const alternative = defineHtmlTextParser(note, {
    selector: 'section',
    priority: 50,
    attributes: (_element, value) => ({ value, label: 'alternative' }),
  });

  const parser = createHtmlParser(schema, [...rules, preferred, alternative]);
  expect(schema.node(note).read(parser.parse('<section>Fallback</section>')[0])?.label).toBe(
    'alternative',
  );
  expect(
    schema.node(group).matches(parser.parse('<section data-group><p>Nested</p></section>')[0]),
  ).toBe(true);
  expect(() => createHtmlParser(schema, [])).toThrow(/exactly one fallback/);
  expect(() => createHtmlParser(schema, [...rules, rules[0]])).toThrow(/exactly one fallback/);
});

test('composed editor parsing binds contributions without creating a view', () => {
  const parsing = defineExtension({
    name: 'parsing',
    options: {},
    setup(_options, context: ContributionContext) {
      for (const rule of rules) context.provide(htmlParsers, rule);

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [...definitions, parsing] }),
    content: [],
  });

  const result = createEditorHtmlParser(editor).parse('<p>Imported</p>');
  expect(editor.schema.text(result[0])).toBe('Imported');
  editor.destroy();
});

test('line breaks inside marks retain formatting and invalid schema attributes fail import', () => {
  const parser = createHtmlParser(schema, rules);
  const nodes = parser.parse('<p><a href="/x">one<br>two</a></p>');
  expect(schema.editing(nodes[0]).marks?.read(nodes[0])).toEqual([
    { from: 0, to: 7, mark: { type: 'link', attrs: { href: '/x' } } },
  ]);

  const invalid = defineHtmlTextParser(note, {
    selector: 'p',
    priority: 100,
    // @ts-expect-error A parser's attributes must match the definition.
    attributes: (_element, value) => ({ value, label: 42 }),
  });

  expect(() => createHtmlParser(schema, [...rules, invalid]).parse('<p>Bad</p>')).toThrow(/string/);
  expect(() =>
    parser.parse('<section>'.repeat(260) + '<p>Too deep</p>' + '</section>'.repeat(260)),
  ).toThrow(/nesting limit/);
  expect(parser.parse('<p>After failure</p>')).toHaveLength(1);
});

test('standalone separator breaks do not create blocks while explicit block breaks round trip', () => {
  const nodes = createHtmlParser(schema, rules).parse(
    '<p>First</p><br> \n <br><h1>Next</h1><p>Last<br></p>',
  );

  expect(nodes.map((node) => schema.text(node))).toEqual(['First', 'Next', 'Last\n']);
});
