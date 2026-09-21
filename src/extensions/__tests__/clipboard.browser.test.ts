import { expect, test } from 'vitest';

import { createEditor, textSelection, TextSelection } from '../../state';
import { readClipboard, writeClipboard } from '../clipboard';
import type { StarterNode } from '../demo-model';
import { demoSchema } from '../demo-schema';

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
