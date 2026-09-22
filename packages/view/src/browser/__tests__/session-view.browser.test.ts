import { createEditor } from '@gprose/core';
import { createSchema, defineNode } from '@gprose/model';
import { textSelection } from '@gprose/state';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { mountEditorView, type BrowserViewOptions } from '../native-view.js';

const schema = createSchema({
  extensions: [
    defineNode({
      name: 'note',
      version: 1,
      options: {},
      schema: () => ({
        attributes: z.strictObject({ text: z.string() }),
        content: { kind: 'text', field: 'text' },
      }),
    }),
  ],
});

const session = () => createEditor({ schema, content: [{ kind: 'note', id: 1, text: 'Text' }] });

function options(
  editor: ReturnType<typeof session>,
  input: HTMLTextAreaElement,
  key: () => void,
): BrowserViewOptions {
  return {
    session: editor,
    pointer: {
      selection: () => editor.state.selection,
      onSelect: editor.select,
      hitTest: () => null,
      focus: () => input.focus(),
    },
    input: { element: () => input, keydown: key },
  };
}

test('mounted view owns session effects and removes listeners when the session is destroyed', () => {
  const editor = session();
  const host = document.createElement('div');
  const input = document.createElement('textarea');
  host.append(input);
  document.body.append(host);
  let keys = 0;
  const config = options(editor, input, () => keys++);
  const revealed: unknown[] = [];

  const view = mountEditorView(host, {
    ...config,
    revealSelection: (selection) => revealed.push(selection),
  });

  try {
    editor.commands.focus();
    expect(document.activeElement).toBe(input);
    editor.select(textSelection(1, 2));
    editor.commands.scrollIntoView();
    expect(revealed).toEqual([editor.state.selection]);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(keys).toBe(1);
    editor.destroy();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(keys).toBe(1);
    expect(() => view.update(config)).toThrow('Editor view is destroyed');
  } finally {
    view.destroy();
    host.remove();
  }
});

test('duplicate mounts clean up their listeners and unmounting permits attachment to a new host', () => {
  const editor = session();
  const host = document.createElement('div');
  const input = document.createElement('textarea');
  host.append(input);
  let keys = 0;
  let rejectedKeys = 0;
  const config = options(editor, input, () => keys++);
  const first = mountEditorView(host, config);
  expect(() =>
    mountEditorView(
      host,
      options(editor, input, () => rejectedKeys++),
    ),
  ).toThrow(/one mounted view/);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
  expect(keys).toBe(1);
  expect(rejectedKeys).toBe(0);
  expect(() => first.update({ ...config, session: session() })).toThrow(
    /cannot change its editor session/,
  );
  first.destroy();
  first.destroy();
  expect(editor.isDestroyed).toBe(false);
  const second = mountEditorView(host, config);

  try {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(keys).toBe(2);
  } finally {
    second.destroy();
    editor.destroy();
  }
});
