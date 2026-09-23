import { readClipboard, writeClipboard } from '@kerned/extension-editing/browser';
import { createDocumentSerializer, indexTree } from '@kerned/model';
import { starterSerializers } from '@kerned/starter-kit';
import { starterHtmlParsers } from '@kerned/starter-kit/browser';
import { createEditor, textSelection, TextSelection } from '@kerned/state';
import { createHtmlParser } from '@kerned/view';
import { expect, test } from 'vitest';

import type { StarterNode } from '../../../../apps/demo/src/demo-model.js';
import { demoSchema } from '../../../../apps/demo/src/demo-schema.js';

test('copying a heading does not carry its attributes into the empty split target', () => {
  const nodes: StarterNode[] = [
    { kind: 'heading', id: 1, key: 'title', level: 2, text: 'Title', marks: [], inline: [] },
  ];

  const editor = createEditor(demoSchema, nodes, textSelection(1, 0, 5));
  const data = new DataTransfer();
  writeClipboard(data, demoSchema, editor.state, 'Title');
  expect(data.getData('text/plain')).toBe('Title');
  expect(data.getData('text/html')).toBe('<h2>Title</h2>');
  expect(readClipboard(data, demoSchema)?.nodes).toEqual(nodes);
  expect(readClipboard(data, demoSchema)?.nodes[0]).toBe(nodes[0]);
});

test('copying a partial styled paragraph slices both ends without restoring source content', () => {
  const nodes: StarterNode[] = [
    {
      kind: 'paragraph',
      id: 1,
      key: 'paragraph',
      text: 'Hello',
      marks: [{ from: 0, to: 5, mark: { type: 'bold', attrs: null } }],
      inline: [],
    },
  ];

  const editor = createEditor(demoSchema, nodes, textSelection(1, 1, 4));
  const data = new DataTransfer();
  writeClipboard(data, demoSchema, editor.state, 'ell');
  expect(data.getData('text/html')).toBe('<p><strong>ell</strong></p>');
  expect(readClipboard(data, demoSchema)?.nodes[0]).toMatchObject({
    text: 'ell',
    marks: [{ from: 0, to: 3, mark: { type: 'bold', attrs: null } }],
  });
});

test('whole-block copying keeps selected empty blocks but excludes a collapsed empty caret', () => {
  const nodes: StarterNode[] = [
    { kind: 'paragraph', id: 1, key: 'first', text: 'A', marks: [], inline: [] },
    { kind: 'paragraph', id: 2, key: 'empty', text: '', marks: [], inline: [] },
    { kind: 'paragraph', id: 3, key: 'last', text: 'B', marks: [], inline: [] },
  ];

  const editor = createEditor(
    demoSchema,
    nodes,
    new TextSelection({ id: 1, offset: 0 }, { id: 3, offset: 1 }),
  );

  const selected = new DataTransfer();
  writeClipboard(selected, demoSchema, editor.state, 'A\n\nB');
  expect(readClipboard(selected, demoSchema)?.nodes).toEqual(nodes);
  editor.select(textSelection(2, 0));
  const collapsed = new DataTransfer();
  writeClipboard(collapsed, demoSchema, editor.state, '');
  expect(readClipboard(collapsed, demoSchema)?.nodes).toEqual([]);
});

const parser = createHtmlParser(demoSchema, starterHtmlParsers);

const serializer = createDocumentSerializer(demoSchema, starterSerializers);

test.each([
  {
    source:
      '<ul><li><p>Parent</p><ul><li><p><strong>Child</strong></p></li></ul></li><li><p>Sibling</p></li></ul>',
    start: 'Child',
    end: 'Child',
    from: 0,
    to: 5,
    html: '<p><strong>Child</strong></p>',
  },
  {
    source:
      '<ul><li><p>Parent</p><ul><li><p><strong>Child</strong></p></li></ul></li><li><p>Sibling</p></li></ul>',
    start: 'Child',
    end: 'Sibling',
    from: 1,
    to: 3,
    html: '<ul start="1"><li><p><strong>hild</strong></p></li></ul><ul start="1"><li><p>Sib</p></li></ul>',
  },
  {
    source: '<table><tr><td><p>First</p></td><td><p><em>Second</em></p></td></tr></table>',
    start: 'Second',
    end: 'Second',
    from: 1,
    to: 5,
    html: '<p><em>econ</em></p>',
  },
  {
    source: '<table><tr><td><p>First</p></td><td><p><em>Second</em></p></td></tr></table>',
    start: 'First',
    end: 'Second',
    from: 2,
    to: 3,
    html: '<p>rst</p><p><em>Sec</em></p>',
  },
])(
  'closed clipboard extraction from $start to $end retains exactly selected content',
  ({ source, start, end, from, to, html }) => {
    const nodes = parser.parse(source);
    const tree = indexTree(demoSchema, nodes);
    const anchor = tree.order.find(({ node }) => demoSchema.text(node) === start)?.node;
    const head = tree.order.find(({ node }) => demoSchema.text(node) === end)?.node;

    if (!anchor || !head) throw new Error('Missing selected text');

    const editor = createEditor(
      demoSchema,
      nodes,
      new TextSelection({ id: anchor.id, offset: from }, { id: head.id, offset: to }),
    );

    const data = new DataTransfer();
    writeClipboard(data, demoSchema, editor.state, 'Selected');
    expect(data.getData('text/html')).toBe(html);
    const local = readClipboard(data, demoSchema);

    if (!local) throw new Error('Missing local fragment');
    expect(serializer.serialize(local.nodes).html).toBe(html);
    expect(demoSchema.validateDocument(local.nodes).issues).toBeUndefined();
    const external = new DataTransfer();
    external.setData('text/html', data.getData('text/html'));
    const imported = readClipboard(external, demoSchema);

    if (!imported) throw new Error('Missing imported fragment');
    expect(serializer.serialize(imported.nodes).html).toBe(html);
    editor.destroy();
  },
);

test('failed serialization does not publish a partially written clipboard', () => {
  const nodes = parser.parse('<p>Hello</p>');
  const editor = createEditor(demoSchema, nodes, textSelection(nodes[0].id, 0, 5));
  const data = new DataTransfer();
  const unsupported = createDocumentSerializer(demoSchema, []);
  expect(() => writeClipboard(data, demoSchema, editor.state, 'Hello', unsupported)).toThrow(
    /Missing serializer/,
  );
  expect(data.types).toHaveLength(0);
  editor.destroy();
});
