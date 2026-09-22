import { expect, test, onTestFinished } from 'vitest';
import { z } from 'zod';

import { localHistory } from '../../extensions/history';
import { createSchema, defineNode } from '../../model';
import { textSelection } from '../../state';
import {
  createEditor,
  defineExtension,
  inputRules,
  createInputRules,
  type InputRule,
  type ContributionContext,
} from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ body: z.string() }),
    content: { kind: 'text', field: 'body' },
  }),
});

const group = defineNode({
  name: 'group',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({}),
    content: { kind: 'container', field: 'children', allowed: ['note'] },
  }),
});

const dash: InputRule = {
  find: /--/g,
  run({ transaction, range }) {
    transaction.apply({
      steps: [{ kind: 'replaceText', ...range, text: '—' }],
      selection: textSelection(range.id, range.from + 1),
      input: true,
    });

    return true;
  },
};

function fixture(rules: readonly InputRule[] = [dash]) {
  const feature = defineExtension({
    name: 'rules',
    options: {},
    setup(_options, context: ContributionContext) {
      for (const rule of rules) context.provide(inputRules, rule);

      return {};
    },
  });

  let writable = true;

  const editor = createEditor({
    schema: createSchema({ extensions: [note, group, localHistory, feature] }),
    content: [
      { kind: 'group', id: 1, children: [{ kind: 'note', id: 2, body: '' }] },
      { kind: 'note', id: 3, body: 'Elsewhere' },
    ],
    selection: textSelection(2, 0),
    permissions: { access: () => (writable ? 'editable' : 'read-only') },
  });

  onTestFinished(() => editor.destroy());
  const controller = createInputRules(editor);

  function type(text: string) {
    const node = editor.getNode(2);
    const from = node && editor.schema.text(node)?.length;

    if (from === undefined || from === null) throw new Error('Missing note');
    editor.transact(
      (transaction) => {
        transaction.apply({
          steps: [{ kind: 'replaceText', id: 2, from, to: from, text }],
          selection: textSelection(2, from + text.length),
          input: true,
        });

        return true;
      },
      { history: { group: 'typing:2' } },
    );
  }

  return {
    editor,
    controller,
    type,
    text: () => {
      const node = editor.getNode(2);

      return node?.kind === 'note' ? node.body : undefined;
    },
    lock() {
      writable = false;
    },
  };
}

test('rules transform nested custom text and undo restores literal input before grouped typing', () => {
  const f = fixture();
  f.type('-');
  expect(f.controller.input({ text: '-' })).toBe(false);
  f.type('-');
  expect(f.controller.input({ text: '-' })).toBe(true);
  expect(f.text()).toBe('—');
  expect(f.editor.history.undo).toBe(2);
  f.editor.commands.undo();
  expect(f.text()).toBe('--');
  f.editor.commands.undo();
  expect(f.text()).toBe('');
  f.editor.commands.redo();
  f.editor.commands.redo();
  expect(f.text()).toBe('—');
});

test('priority and installation order determine fallback; declined draft edits and effects are discarded', () => {
  const calls: string[] = [];

  const f = fixture([
    {
      ...dash,
      priority: -10,
      run() {
        calls.push('too late');

        return true;
      },
    },
    {
      ...dash,
      priority: 10,
      run({ transaction, range }) {
        calls.push('decline');
        transaction.step({ kind: 'replaceText', ...range, text: 'discarded' });
        transaction.effect(() => calls.push('effect'));

        return false;
      },
    },
    {
      ...dash,
      priority: 10,
      run(context) {
        calls.push('accept');

        return dash.run(context);
      },
    },
  ]);

  f.type('--');
  expect(f.controller.input({ text: '--' })).toBe(true);
  expect(f.text()).toBe('—');
  expect(calls).toEqual(['decline', 'accept']);
  expect(f.editor.history.undo).toBe(2);
});

test('permission rejection and exceptions retain literal input without partial transformations', () => {
  const f = fixture();
  f.type('--');
  f.lock();
  expect(f.controller.input({ text: '--' })).toBe(false);
  expect(f.text()).toBe('--');
  expect(f.editor.history.undo).toBe(1);

  const failing = fixture([
    {
      ...dash,
      run({ transaction, range }) {
        transaction.step({ kind: 'replaceText', ...range, text: 'discarded' });
        throw new Error('Rule failed');
      },
    },
  ]);

  failing.type('--');
  expect(() => failing.controller.input({ text: '--' })).toThrow('Rule failed');
  expect(failing.text()).toBe('--');
  expect(failing.editor.history.undo).toBe(1);
});

test('composition waits for commit, runs once and declines stale targets', () => {
  const f = fixture();
  f.type('--');
  expect(f.controller.input({ text: '--', composing: true })).toBe(false);
  expect(f.text()).toBe('--');
  expect(f.controller.endComposition()).toBe(true);
  expect(f.controller.endComposition()).toBe(false);
  expect(f.text()).toBe('—');

  const moved = fixture();
  moved.type('--');
  moved.controller.input({ text: '--', composing: true });
  moved.editor.select(textSelection(3, 0));
  expect(moved.controller.endComposition()).toBe(false);
  expect(moved.text()).toBe('--');

  const finalInput = fixture();
  finalInput.type('--');
  finalInput.controller.input({ text: '--', composing: true });
  expect(finalInput.controller.input({ text: '--' })).toBe(true);
  expect(finalInput.controller.endComposition()).toBe(false);
});

test('matching uses the caret end, isolates global regex state, and never cuts graphemes', () => {
  const f = fixture();
  f.type('-- suffix');
  expect(f.controller.input({ text: ' suffix' })).toBe(false);
  f.editor.select(textSelection(2, 2));
  expect(f.controller.input({ text: '-' })).toBe(true);
  expect(f.text()).toBe('— suffix');
  expect(dash.find.lastIndex).toBe(0);

  for (const [text, find] of [
    ['😀', /.$/],
    ['é', /́$/],
  ] as const) {
    const g = fixture([{ ...dash, find }]);
    g.type(text);
    expect(g.controller.input({ text })).toBe(false);
    expect(g.text()).toBe(text);
  }
});

test('indexed node lookup follows changes, moves, undo and missing IDs', () => {
  const f = fixture();
  const original = f.editor.getNode(2);
  f.type('Text');
  expect(f.editor.getNode(2)).not.toBe(original);
  f.editor.transact((transaction) => {
    transaction.step({
      kind: 'moveChildren',
      parent: 1,
      index: 0,
      count: 1,
      toParent: null,
      toIndex: 2,
    });

    return true;
  });
  expect(f.text()).toBe('Text');
  expect(f.editor.getNode(2)).toBe(f.editor.state.nodes[2]);
  f.editor.commands.undo();
  f.editor.commands.undo();
  expect(f.editor.getNode(2)).toEqual(original);
  expect(f.editor.getNode(999)).toBeUndefined();
  f.editor.destroy();
  expect(() => f.editor.getNode(2)).toThrow(/destroyed/);
  expect(() => f.controller.input({ text: '-' })).toThrow(/destroyed/);
});
