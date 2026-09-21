import { expect, test } from 'vitest';
import { z } from 'zod';

import {
  createEditor,
  defineExtension,
  type CommandContext,
  type ExtensionContext,
} from '../../core';
import { createSchema, defineNode, indexTree, type DocumentNode } from '../../model';
import { NodeSelection, textSelection } from '../../state';
import { createBlockCommands } from '../block-commands';
import { localHistory } from '../history';
import { createListCommands, type ListAdapter } from '../lists';

const definitions = [
  defineNode({
    name: 'text',
    version: 1,
    options: {},
    schema: () => ({
      groups: ['block'],
      attributes: z.strictObject({ value: z.string() }),
      content: { kind: 'text', field: 'value' },
    }),
  }),
  defineNode({
    name: 'widget',
    version: 1,
    options: {},
    schema: () => ({
      groups: ['block'],
      attributes: z.strictObject({ label: z.string() }),
      content: { kind: 'atom' },
    }),
  }),
  defineNode({
    name: 'panel',
    version: 1,
    options: {},
    schema: () => ({
      groups: ['block'],
      attributes: z.strictObject({ title: z.string() }),
      content: { kind: 'container', field: 'body', allowedGroups: ['block'] },
    }),
  }),
  defineNode({
    name: 'quotation',
    version: 1,
    options: {},
    schema: () => ({
      groups: ['block'],
      attributes: z.strictObject({}),
      content: { kind: 'container', field: 'body', allowedGroups: ['block'] },
    }),
  }),
  defineNode({
    name: 'sequence',
    version: 1,
    options: {},
    schema: () => ({
      groups: ['block'],
      attributes: z.strictObject({ ordered: z.boolean(), start: z.number().int().positive() }),
      content: { kind: 'container', field: 'items', allowed: ['entry'] },
    }),
  }),
  defineNode({
    name: 'entry',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({}),
      content: {
        kind: 'container',
        field: 'blocks',
        allowedGroups: ['block'],
        parents: ['sequence'],
      },
    }),
  }),
] as const;

type Node = DocumentNode<typeof definitions>;

const list: ListAdapter<Node> = {
  list: (node) => (node.kind === 'sequence' ? { ...node, children: node.items } : null),
  item: (node) => (node.kind === 'entry' ? { children: node.blocks } : null),
  isBlock: (node) => node.kind !== 'entry',
  createList: (identity, settings) => ({ kind: 'sequence', ...identity, ...settings, items: [] }),
  createItem: (identity) => ({ kind: 'entry', ...identity, blocks: [] }),
};

const blocks = createBlockCommands<Node>({
  list,
  isQuote: (node) => node.kind === 'quotation',
  createQuote: (identity) => ({ kind: 'quotation', ...identity, body: [] }),
  withOrdered: (node, ordered) => ({ ...node, ordered }),
});

const lists = createListCommands(list);

const editing = defineExtension({
  name: 'structure',
  options: {},
  setup(_options, { schema }: ExtensionContext<Node>) {
    return {
      commands: {
        quote: {
          execute(context: CommandContext<Node>, ids: number[]) {
            const steps = blocks(schema, context.state, ids, context.allocate).quote();

            if (!steps.length) return false;
            context.steps(steps);

            return true;
          },
        },
        list: {
          execute(context: CommandContext<Node>, ids: number[], ordered = false) {
            const steps = blocks(schema, context.state, ids, context.allocate).list(ordered);

            if (!steps.length) return false;
            context.steps(steps);

            return true;
          },
        },
        indent: {
          execute(context: CommandContext<Node>, itemId: number) {
            context.steps(lists.indent(schema, context.state, itemId, context.allocate).steps);

            return true;
          },
        },
      },
    };
  },
});

const schema = createSchema({ extensions: [...definitions, editing, localHistory] });

function session() {
  return createEditor({
    schema,
    content: [
      {
        kind: 'panel',
        id: 1,
        title: 'Custom container',
        body: [
          { kind: 'text', id: 2, value: 'Text' },
          { kind: 'widget', id: 3, label: 'Interactive card' },
        ],
      },
    ],
  });
}

test('named structural commands retain foreign content and use the composed child storage', () => {
  const editor = session();
  editor.select(textSelection(2, 0));
  const original = editor.state;
  expect(editor.can().chain().list([2, 3]).quote([2, 3]).run()).toBe(true);
  expect(editor.state).toBe(original);
  expect(editor.chain().list([2, 3]).quote([2, 3]).run()).toBe(true);
  const panel = editor.state.nodes[0];

  if (panel.kind !== 'panel') throw new Error('Expected panel');
  expect(panel.title).toBe('Custom container');
  const quote = panel.body[0];

  if (quote.kind !== 'quotation') throw new Error('Expected quotation');
  const sequence = quote.body[0];

  if (sequence.kind !== 'sequence') throw new Error('Expected sequence');
  expect(sequence.items.map((item) => item.blocks[0].kind)).toEqual(['text', 'widget']);
  expect(sequence.items[1].blocks[0]).toMatchObject({ id: 3, label: 'Interactive card' });
  expect(editor.history.undo).toBe(1);
  editor.commands.undo();
  expect(editor.state.nodes).toEqual(original.nodes);
  editor.commands.redo();
  expect(editor.state.nodes[0]).toEqual(panel);
});

test('list indentation and toggles preserve a selected custom atom', () => {
  const editor = session();
  editor.select(new NodeSelection(3));
  expect(editor.commands.list([2, 3])).toBe(true);
  const panel = editor.state.nodes[0];

  if (panel.kind !== 'panel') throw new Error('Expected panel');
  const sequence = panel.body[0];

  if (sequence.kind !== 'sequence') throw new Error('Expected sequence');
  expect(editor.commands.indent(sequence.items[1].id)).toBe(true);
  expect(editor.state.selection).toEqual(new NodeSelection(3));
  expect(editor.commands.list([3], true)).toBe(true);
  expect(editor.commands.list([3], true)).toBe(true);
  expect(editor.state.selection).toEqual(new NodeSelection(3));
});

test('unrelated sibling selections make list commands unavailable without throwing', () => {
  const editor = session();
  expect(editor.can().list([1, 2])).toBe(false);
  expect(editor.commands.list([1, 2])).toBe(false);
  expect(editor.history.undo).toBe(0);
});

test('quoting a large sibling selection visits node identities linearly', () => {
  let identityReads = 0;
  const count = 200;

  const nodes = Array.from({ length: count }, (_, index) => ({
    kind: 'text' as const,
    get id() {
      identityReads++;

      return index + 1;
    },
    key: `text-${index}`,
    value: 'Text',
  }));

  const state = { nodes, revision: 0, selection: textSelection(1, 0) };
  const tree = indexTree(schema, nodes);
  identityReads = 0;

  const changes = blocks(
    schema,
    state,
    Array.from({ length: count }, (_, index) => index + 1),
    () => ({ id: -1, key: 'quote' }),
    tree,
  ).quote();

  expect(changes).toHaveLength(1);
  expect(identityReads).toBeLessThan(count * 20);
});
