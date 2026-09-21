import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../../core';
import { mountEditor, defineNodePresentation, presentations } from '../../../editor-canvas';
import { createSchema, defineNode } from '../../../model';
import { textSelection } from '../../../state';
import { starterBrowserExtensions } from '../browser';

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block', 'textblock'],
    attributes: z.strictObject({ body: z.string() }),
    content: { kind: 'text', field: 'body', marks: 'styles' },
  }),
});

const noteView = defineExtension({
  name: 'noteView',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(note, () => (attrs) => ({
        kind: 'text',
        text: attrs.body,
        size: 18,
        lineHeight: 28,
        before: 0,
        after: 16,
        baselineGrid: 4,
        spans: [],
        atoms: [],
      })),
    );

    return {};
  },
});

test('starter input edits foreign text fields through the shared native mount, including formatting and history', async ({
  onTestFinished,
}) => {
  const schema = createSchema({ extensions: [...starterBrowserExtensions(), note, noteView] });

  const editor = createEditor({
    schema,
    content: [
      { kind: 'note', id: 1, body: 'Custom text' },
      { kind: 'paragraph', id: 2, text: 'Standard text' },
    ],
    selection: textSelection(1, 7),
  });

  const host = document.createElement('div');
  host.style.cssText = 'width:480px;height:300px;';
  document.body.append(host);
  const view = mountEditor(host, { editor });
  onTestFinished(() => {
    view.destroy();
    editor.destroy();
    host.remove();
  });
  await view.ready;
  editor.commands.focus();
  const input = host.querySelector('textarea');

  if (!input) throw new Error('Missing native capture');
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }),
  );
  input.setRangeText('bold ', input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'bold ' }),
  );
  await frame();
  expect(editor.state.nodes[0]).toMatchObject({
    kind: 'note',
    body: 'Custom bold text',
    styles: [{ from: 7, to: 12, mark: { type: 'bold' } }],
  });
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
  );
  await frame();
  expect(editor.state.nodes[0]).toMatchObject({ kind: 'note', body: 'Custom text' });
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await frame();
  expect(editor.state.nodes[0]).toMatchObject({ body: 'Custom bold text' });
  editor.select(textSelection(2, 'Standard text'.length));
  await frame();
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await frame();
  expect(editor.state.nodes).toHaveLength(3);
  expect(editor.state.nodes[2]).toMatchObject({ kind: 'paragraph', text: '' });
  expect(view.status).toBe('ready');
});
