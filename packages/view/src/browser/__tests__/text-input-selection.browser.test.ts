import { createEditor } from '@gprose/core';
import { createSchema, defineNode } from '@gprose/model';
import { TextSelection, textSelection } from '@gprose/state';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createTextInput } from '../text-input.js';

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

function fixture() {
  const editor = createEditor({
    schema,
    content: [
      { kind: 'note', id: 1, text: 'A😀e\u0301Z' },
      { kind: 'note', id: 2, text: 'Second' },
    ],
  });

  const input = document.createElement('textarea');
  document.body.append(input);
  const capture = createTextInput(schema, editor);
  const selections: TextSelection[] = [];
  let selectAll = 0;

  const detach = capture.mount(
    input,
    () => {
      selectAll++;
    },
    (selection) => {
      selections.push(selection);
      editor.select(selection);
    },
  );

  capture.sync(input);

  return {
    editor,
    input,
    capture,
    selections,
    detach,
    get all() {
      return selectAll;
    },
    select(from: number, to = from, direction: 'forward' | 'backward' = 'forward') {
      input.setSelectionRange(from, to, direction);
      input.dispatchEvent(new Event('select'));
    },
    destroy() {
      capture.destroy();
      input.remove();
      editor.destroy();
    },
  };
}

test('native caret and backward selection map to grapheme-safe editor positions without keydown', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.select(2);
  expect(f.editor.state.selection).toEqual(textSelection(1, 1));
  // Several native movements before a paint must all reach the model.
  f.select(3, 5, 'backward');
  expect(f.editor.state.selection).toEqual(
    new TextSelection({ id: 1, offset: 5 }, { id: 1, offset: 3 }),
  );
  f.capture.sync(f.input);
  expect(f.input.selectionDirection).toBe('backward');
  expect([f.input.selectionStart, f.input.selectionEnd]).toEqual([3, 5]);
  f.input.dispatchEvent(new Event('select'));
  expect(f.selections).toHaveLength(2);
  expect(f.all).toBe(0);
});

test('queued model selection events do not promote paragraph selection or reverse its direction', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const backward = new TextSelection({ id: 1, offset: 6 }, { id: 1, offset: 0 });
  f.editor.select(backward);
  f.capture.sync(f.input);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(f.input.selectionDirection).toBe('backward');
  expect(f.editor.state.selection).toEqual(backward);
  expect(f.all).toBe(0);
  expect(f.selections).toHaveLength(0);
  f.select(0, 6, 'forward');
  expect(f.editor.state.selection).toEqual(textSelection(1, 0, 6));
  expect(f.all).toBe(0);
});

test('composition, uncommitted input, stale nodes and detached captures cannot overwrite selection', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.capture.compositionStart();
  f.select(3);
  expect(f.selections).toHaveLength(0);
  f.capture.compositionEnd(null);
  f.input.value = 'Uncommitted';
  f.select(2);
  expect(f.selections).toHaveLength(0);
  f.capture.sync(f.input);
  f.editor.select(textSelection(2, 2));
  f.select(3);
  expect(f.editor.state.selection).toEqual(textSelection(2, 2));
  f.capture.sync(f.input);
  f.detach();
  f.select(1);
  expect(f.editor.state.selection).toEqual(textSelection(2, 2));
});

test('focused document selectionchange maps caret changes and retains native Select All', ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.input.focus();
  f.input.setSelectionRange(3, 3);
  document.dispatchEvent(new Event('selectionchange'));
  expect(f.editor.state.selection).toEqual(textSelection(1, 3));
  f.select(0, f.input.value.length);
  expect(f.all).toBe(1);
  f.input.dispatchEvent(new Event('select'));
  expect(f.all).toBe(1);
});

test('native caret movement can be followed by input, while stale composition cannot edit a new block', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const changes: { from: number; to: number; text: string }[] = [];
  const replace = (from: number, to: number, text: string) => changes.push({ from, to, text });
  f.select(3);
  f.input.value = 'A😀文e\u0301Z';
  f.capture.read(f.input, replace);
  expect(changes).toEqual([{ from: 3, to: 3, text: '文' }]);
  f.capture.sync(f.input);
  f.capture.compositionStart();
  f.editor.select(textSelection(2, 0));
  f.input.value = '候选';
  f.capture.read(f.input, replace);
  expect(changes).toHaveLength(1);
  f.input.value = '候选';
  let commits = 0;
  f.capture.compositionEnd(f.input, () => {
    commits++;
  });
  f.capture.read(f.input, replace);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(changes).toHaveLength(1);
  expect(commits).toBe(0);
  expect(f.input.value).toBe('Second');
});

test('composition end without a final input event still rejects a changed selection', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.capture.compositionStart();
  f.editor.select(textSelection(2, 0));
  let commits = 0;
  f.capture.compositionEnd(f.input, () => {
    commits++;
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(commits).toBe(0);
  expect(f.input.value).toBe('Second');
});

test('revoked access clears the native buffer during composition and read-only input is rejected', ({
  onTestFinished,
}) => {
  let access: 'editable' | 'read-only' | 'protected' = 'editable';

  const editor = createEditor({
    schema,
    content: [{ kind: 'note', id: 1, text: 'Private text' }],
    permissions: { access: () => access },
  });

  const input = document.createElement('textarea');
  const capture = createTextInput(schema, editor);
  onTestFinished(() => {
    capture.destroy();
    editor.destroy();
  });
  capture.sync(input);
  expect(input.value).toBe('Private text');
  capture.compositionStart();
  access = 'protected';
  editor.refreshPermissions();
  capture.sync(input);
  expect(input.value).toBe('');
  expect(capture.composing).toBe(false);
  const changes: string[] = [];
  input.value = 'Injected';
  capture.read(input, (_from, _to, text) => changes.push(text));
  expect(changes).toEqual([]);
  expect(input.value).toBe('');
  capture.compositionEnd(null);
  access = 'read-only';
  editor.refreshPermissions();
  capture.sync(input);
  expect(input.value).toBe('Private text');
  input.value += '!';
  capture.read(input, (_from, _to, text) => changes.push(text));
  expect(changes).toEqual([]);
  expect(input.value).toBe('Private text');
});

test('a new composition invalidates the previous deferred commit', async ({ onTestFinished }) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  let commits = 0;
  f.capture.compositionStart();
  f.capture.compositionEnd(f.input, () => {
    commits++;
  });
  f.capture.compositionStart();
  f.input.value = 'New candidate';
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(f.capture.composing).toBe(true);
  expect(f.input.value).toBe('New candidate');
  expect(commits).toBe(0);
});
