import { localHistory } from '@gprose/extension-history';
import {
  createSchema,
  defineNode,
  indexTree,
  type NodeIdentity,
  type SelectionRange,
} from '@gprose/model';
import {
  NodeSelection,
  TextSelection,
  textSelection,
  type CommandContext,
  type NodeAccess,
} from '@gprose/state';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor, createPendingEdit } from '../index.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.object({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const group = defineNode({
  name: 'group',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.object({}),
    content: { kind: 'container', field: 'children', allowedGroups: ['block'] },
  }),
});

const schema = createSchema({ extensions: [note, group, localHistory] });

function fixture() {
  const access = new Map<number, NodeAccess>();

  const editor = createEditor({
    schema,
    selection: textSelection(2, 4),
    content: [
      { kind: 'group', id: 1, children: [{ kind: 'note', id: 2, key: 'target', text: 'abcdef' }] },
      { kind: 'note', id: 3, text: 'Other' },
    ],
    permissions: { access: (node) => access.get(node.id) ?? 'editable' },
  });

  return { editor, access };
}

function replace<N extends NodeIdentity>(
  context: CommandContext<N>,
  ranges: readonly SelectionRange[],
) {
  context.step({ kind: 'replaceRanges', ranges, text: 'RESULT', pruneEmpty: [] });

  return true;
}

test('delayed caret insertion follows subtree moves and splits using a fresh transaction and separate undo', ({
  onTestFinished,
}) => {
  const { editor } = fixture();
  onTestFinished(() => editor.destroy());
  const pending = createPendingEdit(editor);

  if (!pending) throw new Error('Missing target');
  expect(JSON.parse(JSON.stringify(pending.target))).toEqual(pending.target);
  editor.transact((draft) => {
    draft.step({ kind: 'moveChildren', parent: 1, index: 0, count: 1, toParent: null, toIndex: 2 });
    draft.step({ kind: 'split', id: 2, at: 2, rightId: 4, rightKey: 'split' });
    draft.select(textSelection(3, 1));

    return true;
  });
  const before = editor.state;
  expect(
    pending.commit((context, ranges) => {
      expect(context.state).toBe(before);
      expect(ranges).toEqual([{ kind: 'text', id: 4, from: 2, to: 2 }]);

      return replace(context, ranges);
    }),
  ).toEqual({ status: 'applied' });
  expect(editor.state.selection).toEqual(textSelection(3, 1));
  expect(schema.text(editor.state.nodes[3])).toBe('cdRESULTef');
  expect(pending.commit(replace)).toEqual({ status: 'settled' });
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.nodes).toEqual(before.nodes);
});

test('captured ranges include inserted content, and a deleted target never calls the command', ({
  onTestFinished,
}) => {
  const { editor } = fixture();
  onTestFinished(() => editor.destroy());
  const selection = new TextSelection({ id: 2, offset: 1 }, { id: 2, offset: 5 });
  const pending = createPendingEdit(editor, selection);

  if (!pending) throw new Error('Missing range');
  editor.transact((draft) => {
    draft.step({ kind: 'replaceText', id: 2, from: 3, to: 3, text: 'NEW' });

    return true;
  });
  expect(
    pending.commit((context, ranges) => {
      expect(ranges).toEqual([{ kind: 'text', id: 2, from: 1, to: 8 }]);

      return replace(context, ranges);
    }),
  ).toEqual({ status: 'applied' });
  const changed = indexTree(schema, editor.state.nodes).byId.get(2);
  expect(changed && schema.text(changed.node)).toBe('aRESULTf');
  const deleted = createPendingEdit(editor, selection);

  if (!deleted) throw new Error('Missing deletion target');
  editor.transact((draft) => {
    draft.step({ kind: 'removeChildren', parent: 1, index: 0, count: 1 });

    return true;
  });
  expect(
    deleted.commit(() => {
      throw new Error('Deleted target was edited');
    }),
  ).toEqual({ status: 'deleted' });
});

test('current permission policy governs delayed content edits while readonly unlocked nodes remain deletable', ({
  onTestFinished,
}) => {
  const { editor, access } = fixture();
  onTestFinished(() => editor.destroy());
  const pending = createPendingEdit(editor);

  if (!pending) throw new Error('Missing caret');
  access.set(1, 'read-only');
  const before = editor.state;
  expect(pending.commit(replace)).toEqual({ status: 'rejected' });
  expect(editor.state).toBe(before);
  const removal = createPendingEdit(editor, new NodeSelection(1));

  if (!removal) throw new Error('Missing node target');
  expect(
    removal.commit((context, ranges) => {
      expect(ranges).toEqual([{ kind: 'node', id: 1 }]);
      context.step({ kind: 'removeChildren', parent: null, index: 0, count: 1 });

      return true;
    }),
  ).toEqual({ status: 'applied' });
});

test('superseded work and session destruction abort requests; completion is single-use even after rejection or errors', () => {
  const { editor } = fixture();
  const cancelled = createPendingEdit(editor);
  const rejected = createPendingEdit(editor);
  const failed = createPendingEdit(editor);
  const destroyed = createPendingEdit(editor);

  if (!cancelled || !rejected || !failed || !destroyed) throw new Error('Missing pending edits');
  cancelled.cancel();
  cancelled.cancel();
  expect(cancelled.signal.aborted).toBe(true);
  expect(cancelled.commit(replace)).toEqual({ status: 'cancelled' });
  expect(rejected.commit(() => false)).toEqual({ status: 'rejected' });
  expect(() =>
    failed.commit(() => {
      throw new Error('Invalid response');
    }),
  ).toThrow('Invalid response');
  editor.destroy();
  expect(destroyed.signal.aborted).toBe(true);
  expect(destroyed.commit(replace)).toEqual({ status: 'cancelled' });
  expect(rejected.signal.aborted).toBe(false);
  expect(failed.signal.aborted).toBe(false);
  expect(failed.commit(replace)).toEqual({ status: 'settled' });
  expect(() => createPendingEdit(editor)).toThrow('Editor is destroyed');
});

test('an empty document has no delayed target and allocates no pending request', () => {
  const editor = createEditor({ schema, content: [] });
  expect(createPendingEdit(editor)).toBeNull();
  editor.destroy();
});
