import { createSchema, defineNode, type DocumentInput } from '@gprose/model';
import {
  AllSelection,
  NodeSelection,
  TextSelection,
  RangeSelection,
  textSelection,
  equalScopedSelection,
  selectionInText,
  type SelectionContext,
} from '@gprose/state';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { localHistory } from '../../../../src/extensions/history.js';
import { createEditor } from '../index.js';

const text = defineNode({
  name: 'text',
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
    content: { kind: 'container', field: 'children', allowedGroups: ['block'], minChildren: 1 },
  }),
});

const schema = createSchema({ extensions: [text, group, localHistory] });

const content = [
  {
    kind: 'group',
    id: 1,
    children: [
      { kind: 'group', id: 2, children: [{ kind: 'text', id: 3, text: 'Nested text' }] },
      { kind: 'text', id: 4, text: 'Sibling' },
    ],
  },
  { kind: 'text', id: 5, text: 'Outside' },
] satisfies DocumentInput<typeof schema.definitions>;

function fixture() {
  return createEditor({ schema, content });
}

test('scoped selections distinguish nested carets, text ranges, whole nodes and unrelated nodes', ({
  onTestFinished,
}) => {
  const editor = fixture();
  onTestFinished(() => editor.destroy());
  editor.select(textSelection(3, 2));
  const caret = { kind: 'caret', point: { kind: 'text', id: 3, offset: 2 }, upstream: false };

  for (const id of [1, 2, 3]) expect(editor.getSelection(id)).toEqual(caret);
  expect(editor.getSelection(4)).toEqual({ kind: 'none' });
  expect(editor.getSelection(99)).toBeUndefined();
  editor.select(new TextSelection({ id: 3, offset: 2 }, { id: 5, offset: 3 }));
  expect(editor.getSelection(1)).toEqual({
    kind: 'range',
    ranges: [
      { kind: 'text', id: 3, from: 2, to: 11 },
      { kind: 'text', id: 4, from: 0, to: 7 },
    ],
  });
  expect(editor.getSelection(5)).toEqual({
    kind: 'range',
    ranges: [{ kind: 'text', id: 5, from: 0, to: 3 }],
  });
  const forward = editor.getSelection(1);
  editor.select(new TextSelection({ id: 5, offset: 3 }, { id: 3, offset: 2 }));
  expect(editor.getSelection(1)).toEqual(forward);
  editor.select(new NodeSelection(2));
  expect(editor.getSelection(1)).toEqual({ kind: 'range', ranges: [{ kind: 'node', id: 2 }] });

  for (const id of [2, 3]) expect(editor.getSelection(id)).toEqual({ kind: 'node' });
  expect(editor.getSelection(4)).toEqual({ kind: 'none' });
  editor.select(new AllSelection());

  for (const id of [1, 2, 3, 4, 5]) expect(editor.getSelection(id)).toEqual({ kind: 'node' });
});

test('structural carets belong to their containing subtree, without selecting the adjacent node', ({
  onTestFinished,
}) => {
  const editor = fixture();
  onTestFinished(() => editor.destroy());
  const point = { kind: 'node', id: 2, side: 'after' } as const;
  editor.select(new RangeSelection(point, point));
  expect(editor.getSelection(1)).toEqual({ kind: 'caret', point, upstream: false });

  for (const id of [2, 3, 4, 5]) expect(editor.getSelection(id)).toEqual({ kind: 'none' });
});

test('one selection projection serves every query and permission refresh; edits, undo and selection changes invalidate it', ({
  onTestFinished,
}) => {
  const editor = fixture();
  onTestFinished(() => editor.destroy());
  let reads = 0;

  class ObservedSelection extends TextSelection {
    override ranges(context: SelectionContext) {
      reads++;

      return super.ranges(context);
    }
  }

  editor.select(new ObservedSelection({ id: 3, offset: 2 }));
  reads = 0;
  const first = editor.getSelection(3);

  for (let index = 0; index < 100; index++)
    for (const id of [1, 2, 3, 4, 5]) editor.getSelection(id);
  editor.refreshPermissions();
  expect(editor.getSelection(3)).toBe(first);
  expect(reads).toBe(1);
  editor.transact((draft) => {
    draft.step({ kind: 'replaceText', id: 3, from: 0, to: 0, text: 'New ' });

    return true;
  });
  expect(editor.getSelection(3)).toMatchObject({ kind: 'caret', point: { offset: 6 } });
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getSelection(3)).toEqual(first);
  editor.select(new NodeSelection(2));
  editor.transact((draft) => {
    draft.step({ kind: 'replaceChildren', parent: 1, index: 0, count: 1, nodes: [] });

    return true;
  });
  expect(editor.getSelection(2)).toBeUndefined();
  expect(editor.getSelection(3)).toBeUndefined();
  editor.destroy();
  expect(() => editor.getSelection(4)).toThrow('Editor is destroyed');
});

test('text scopes clip selected content and use affinity at adjacent mark boundaries', ({
  onTestFinished,
}) => {
  const editor = fixture();
  onTestFinished(() => editor.destroy());
  editor.select(new TextSelection({ id: 3, offset: 1 }, { id: 3, offset: 8 }));
  const scope = editor.getSelection(3);

  if (!scope) throw new Error('Missing node');
  expect(selectionInText(scope, 3, 3, 6)).toEqual({
    kind: 'range',
    ranges: [{ kind: 'text', id: 3, from: 3, to: 6 }],
  });
  expect(selectionInText(scope, 3, 8, 10)).toEqual({ kind: 'none' });

  for (const upstream of [false, true]) {
    editor.select(new TextSelection({ id: 3, offset: 4 }, undefined, upstream));
    const caret = editor.getSelection(3);

    if (!caret) throw new Error('Missing caret');
    expect(selectionInText(caret, 3, 0, 4).kind).toBe(upstream ? 'caret' : 'none');
    expect(selectionInText(caret, 3, 4, 8).kind).toBe(upstream ? 'none' : 'caret');
    expect(equalScopedSelection(caret, { ...caret })).toBe(true);
  }

  editor.select(new NodeSelection(2));
  const whole = editor.getSelection(3);

  if (!whole) throw new Error('Missing node');
  expect(selectionInText(whole, 3, 0, 4)).toEqual({ kind: 'node' });
});

test('a zero-width endpoint in a cross-node selection remains a range, never a caret', ({
  onTestFinished,
}) => {
  const editor = fixture();
  onTestFinished(() => editor.destroy());
  editor.select(new TextSelection({ id: 3, offset: 11 }, { id: 4, offset: 0 }));
  const scope = editor.getSelection(4);
  expect(scope).toEqual({
    kind: 'range',
    ranges: [{ kind: 'text', id: 4, from: 0, to: 0 }],
  });

  if (!scope) throw new Error('Missing scope');
  expect(selectionInText(scope, 4, 2, 5)).toEqual({ kind: 'none' });
});
