import { createEditor } from '@gprose/core';
import { createSchema, defineNode, type DocumentNode } from '@gprose/model';
import { NodeSelection, TextSelection, textSelection } from '@gprose/state';
import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createDocumentQuery } from '../document.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({ body: z.string() }),
    content: { kind: 'text', field: 'body' },
  }),
});

const section = defineNode({
  name: 'section',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({ title: z.string() }),
    content: { kind: 'container', field: 'items', allowedGroups: ['block'] },
  }),
});

const grid = defineNode({
  name: 'grid',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.strictObject({ caption: z.string() }),
    content: { kind: 'container', field: 'cells', allowedGroups: ['block'] },
  }),
});

const definitions = [note, section, grid] as const;

const schema = createSchema({ extensions: definitions });

type Node = DocumentNode<typeof definitions>;

type Block = Extract<Node, { kind: 'note' | 'grid' }>;

type Decoration = { depth: number; path: string };

function fixture() {
  const editor = createEditor({
    schema,
    content: [
      {
        kind: 'section',
        id: 10,
        title: 'Outer',
        items: [
          { kind: 'note', id: 0, body: 'First' },
          {
            kind: 'section',
            id: 11,
            title: 'Inner',
            items: [{ kind: 'note', id: 2, body: 'Second' }],
          },
        ],
      },
      {
        kind: 'grid',
        id: 20,
        caption: 'Grid',
        cells: [
          { kind: 'note', id: 21, body: 'Cell A' },
          { kind: 'note', id: 22, body: 'Cell B' },
        ],
      },
      { kind: 'note', id: 3, body: 'Last' },
    ],
  });

  let visits = 0;

  const query = createDocumentQuery<Node, Block, Decoration>(schema, {
    initial: { depth: 0, path: '' },
    isBlock: (node): node is Block => {
      visits++;

      return node.kind !== 'section';
    },
    child: (parent, index, inherited) => ({
      depth: inherited.depth + 1,
      path: `${inherited.path}/${parent.id}:${index}`,
    }),
  });

  return { editor, query, visits: () => visits };
}

test('projection traverses schema-defined children and stops at rendered containers', ({
  onTestFinished,
}) => {
  const { editor, query } = fixture();
  onTestFinished(() => editor.destroy());
  const document = query(editor.state);
  expectTypeOf(document.nodes).toEqualTypeOf<Block[]>();
  expect(document.nodes.map((node) => node.id)).toEqual([0, 2, 20, 3]);
  expect(document.tree.order.map((entry) => entry.node.id)).toEqual([10, 0, 11, 2, 20, 21, 22, 3]);
  expect(document.projection.decorations.get(2)).toEqual({ depth: 2, path: '/10:1/11:0' });
  expect(document.projection.decorations.get(10)).toEqual({ depth: 0, path: '' });
  expect(document.projection.decorations.get(11)).toEqual({ depth: 1, path: '/10:1' });
  expect(document.projection.decorations.get(20)).toEqual({ depth: 0, path: '' });
  expect(document.projection.decorations.has(21)).toBe(false);
  expect(document.blockFor(0)).toBe(document.nodes[0]);
  expect(document.blockFor(2)).toBe(document.nodes[1]);
  expect(document.blockFor(21)).toBe(document.nodes[2]);
  expect(document.blockFor(22)).toBe(document.nodes[2]);
  expect(document.blockFor(11)).toBeUndefined();
  expect(document.blockFor(999)).toBeUndefined();
});

test('projection spans retain nested containers, native owners and empty structural intervals', ({
  onTestFinished,
}) => {
  const { editor, query, visits } = fixture();
  onTestFinished(() => editor.destroy());
  const original = query(editor.state);
  expect(original.spanFor(10)).toMatchObject({ node: { id: 10 }, from: 0, to: 2 });
  expect(original.spanFor(11)).toMatchObject({ node: { id: 11 }, from: 1, to: 2 });
  expect(original.spanFor(21)).toMatchObject({ node: { id: 20 }, from: 2, to: 3 });
  expect(original.spanFor(999)).toBeUndefined();
  const visited = visits();
  editor.select(textSelection(2, 3));
  expect(query(editor.state).spanFor).toBe(original.spanFor);
  expect(query(editor.state).spanFor(11)).toBe(original.spanFor(11));
  expect(visits()).toBe(visited);
  editor.transact((draft) => {
    draft.step({ kind: 'replaceChildren', parent: 11, index: 0, count: 1, nodes: [] });

    return true;
  });
  const emptied = query(editor.state);
  expect(emptied.spanFor(11)).toMatchObject({ from: 1, to: 1 });
  expect(emptied.spanFor(10)).toMatchObject({ from: 0, to: 1 });
  expect(emptied.spanFor(21)).toMatchObject({ from: 1, to: 2 });
  expect(emptied.spanFor(2)).toBeUndefined();
  expect(original.spanFor(11)).toMatchObject({ from: 1, to: 2 });
});

test('forward and backward selections span nested text and rendered containers while excluding a zero-offset final block', ({
  onTestFinished,
}) => {
  const { editor, query } = fixture();
  onTestFinished(() => editor.destroy());

  const first = { id: 0, offset: 1 },
    last = { id: 3, offset: 0 };

  for (const selection of [new TextSelection(first, last), new TextSelection(last, first)]) {
    editor.select(selection);
    const document = query(editor.state);
    expect(document.start).toEqual(first);
    expect(document.end).toEqual(last);
    expect(document.selectedBlocks.map((node) => node.id)).toEqual([0, 2, 20]);
    expect(document.selectedRange(document.nodes[2])).toEqual({ from: 0, to: 1 });
    expect(document.selectedRange(document.nodes[0])).toEqual({ from: 1, to: 5 });
  }

  editor.select(textSelection(3, 0));
  const collapsed = query(editor.state);
  expect(collapsed.selectedBlocks.map((node) => node.id)).toEqual([3]);
  expect(collapsed.selectedRange(collapsed.nodes[3])).toBeNull();
});

test('node selections and text inside an atomic view retain structural selection semantics', ({
  onTestFinished,
}) => {
  const { editor, query } = fixture();
  onTestFinished(() => editor.destroy());
  editor.select(new NodeSelection(10));
  const container = query(editor.state);
  expect(container.selectedBlocks.map((node) => node.id)).toEqual([0, 2]);
  expect(container.selectedRange(container.nodes[1])).toEqual({ from: 0, to: 6 });
  editor.select(new TextSelection({ id: 21, offset: 1 }, { id: 22, offset: 3 }));
  const cells = query(editor.state);
  expect(cells.selectedBlocks.map((node) => node.id)).toEqual([21, 22]);
  expect(cells.active?.id).toBe(22);
  expect(cells.blockFor(cells.active?.id ?? -1)?.id).toBe(20);
  expect(cells.selectedRange(cells.nodes[2])).toBeNull();
  editor.select(new NodeSelection(20));
  const atomic = query(editor.state);
  expect(atomic.selectedBlocks.map((node) => node.id)).toEqual([20]);
  expect(atomic.selectedRange(atomic.nodes[2])).toEqual({ from: 0, to: 1 });
});

test('selection-only queries reuse traversal, while edits and streamed appends preserve older snapshots', ({
  onTestFinished,
}) => {
  const { editor, query, visits } = fixture();
  onTestFinished(() => editor.destroy());
  const originalState = editor.state;
  const original = query(originalState);
  const visited = visits();
  expect(query(originalState)).toBe(original);
  editor.select(textSelection(2, 3));
  const selected = query(editor.state);
  expect(selected.projection).toBe(original.projection);
  expect(selected.tree).toBe(original.tree);
  expect(selected.blockFor).toBe(original.blockFor);
  expect(visits()).toBe(visited);
  editor.transact((context) => {
    context.step({ kind: 'replaceText', id: 2, from: 0, to: 6, text: 'Edited' });

    return true;
  });
  const edited = query(editor.state);
  expect(edited.nodes[1]).toMatchObject({ body: 'Edited' });
  expect(edited.projection).not.toBe(original.projection);
  expect(original.nodes[1]).toMatchObject({ body: 'Second' });
  expect(query(originalState)).toBe(original);
  const appended = schema.node(note).create({ id: 30, key: 'append' }, { body: 'Appended' });
  editor.transact((context) => {
    context.step({ kind: 'replaceChildren', parent: null, index: 3, count: 0, nodes: [appended] });

    return true;
  });
  const streamed = query(editor.state);
  expect(streamed.nodes.map((node) => node.id)).toEqual([0, 2, 20, 3, 30]);
  expect(streamed.blockFor(30)).toBe(appended);
  expect(original.nodes).toHaveLength(4);
  expect(original.blockFor(30)).toBeUndefined();
});
