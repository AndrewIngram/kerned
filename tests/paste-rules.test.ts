import { expect, test, onTestFinished } from 'vitest';

import { createEditor, defineExtension, type ContributionContext } from '../src/core';
import { createPasteRules, pasteRules, type PasteRule } from '../src/editor-browser';
import { starterExtensions } from '../src/extensions/starter-kit';
import { editingCommands } from '../src/extensions/starter-kit/commands';
import { createSchema } from '../src/model';
import { textSelection } from '../src/state';

function fixture(rules: readonly PasteRule[], writable = true) {
  const extension = defineExtension({
    name: 'customPaste',
    options: {},
    setup(_options, context: ContributionContext) {
      for (const rule of rules) context.provide(pasteRules, rule);

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [...starterExtensions, extension] }),
    content: [{ kind: 'paragraph', id: 1, text: '' }],
    selection: textSelection(1, 0),
    permissions: { access: () => (writable ? 'editable' : 'read-only') },
  });

  onTestFinished(() => editor.destroy());

  return { editor, paste: createPasteRules(editor) };
}

const data = {
  types: ['text/plain'],
  getData: (type: string) => (type === 'text/plain' ? 'paste' : ''),
};

test('paste rules preserve priority/tie order and commit only the first accepting draft', () => {
  const calls: string[] = [];

  const { editor, paste } = fixture([
    {
      priority: -1,
      run() {
        calls.push('default');

        return true;
      },
    },
    {
      priority: 10,
      run({ transaction }) {
        calls.push('decline');
        transaction.command(editingCommands.insertText, 'discarded');
        transaction.effect(() => calls.push('discarded effect'));

        return false;
      },
    },
    {
      priority: 10,
      run({ transaction, clipboard }) {
        calls.push('accept');
        expect(clipboard.types).toEqual(['text/plain']);
        expect(clipboard.getData('missing')).toBe('');
        transaction.effect(() => calls.push('committed effect'));

        return transaction.command(editingCommands.insertText, clipboard.getData('text/plain'));
      },
    },
  ]);

  expect(paste(data)).toBe(true);
  expect(editor.getNode(1)).toMatchObject({ text: 'paste' });
  expect(calls).toEqual(['decline', 'accept', 'committed effect']);
  expect(editor.history.undo).toBe(1);
  editor.commands.undo();
  expect(editor.getNode(1)).toMatchObject({ text: '' });
});

test('permission rejection and rule exceptions leave no partial edits or history', () => {
  const denied = fixture(
    [
      {
        run({ transaction }) {
          return transaction.command(editingCommands.insertText, 'denied');
        },
      },
    ],
    false,
  );

  expect(denied.paste(data)).toBe(false);
  expect(denied.editor.getNode(1)).toMatchObject({ text: '' });
  expect(denied.editor.history.undo).toBe(0);

  const failed = fixture([
    {
      run({ transaction }) {
        transaction.command(editingCommands.insertText, 'discarded');
        throw new Error('Failed paste');
      },
    },
  ]);

  expect(() => failed.paste(data)).toThrow('Failed paste');
  expect(failed.editor.getNode(1)).toMatchObject({ text: '' });
  expect(failed.editor.history.undo).toBe(0);
});

test('empty registries decline and disposed sessions or invalid priorities fail explicitly', () => {
  const f = fixture([]);
  expect(f.paste(data)).toBe(false);
  f.editor.destroy();
  expect(() => f.paste(data)).toThrow(/destroyed/);
  expect(() => fixture([{ priority: NaN, run: () => true }])).toThrow(/priority/);
});
