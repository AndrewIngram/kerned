import { expect, test, onTestFinished } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../core';
import { createSchema, defineNode } from '../../model';
import { keyboardShortcuts, createKeyboardShortcuts, type KeyboardShortcut } from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

function fixture(shortcuts: readonly KeyboardShortcut[], platform: 'mac' | 'other' = 'other') {
  const extension = defineExtension({
    name: 'keys',
    options: {},
    setup(_options, context: ContributionContext) {
      for (const shortcut of shortcuts) context.provide(keyboardShortcuts, shortcut);

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [note, extension] }),
    content: [{ kind: 'note', id: 1, text: 'Text' }],
  });

  onTestFinished(() => editor.destroy());

  return { editor, dispatch: createKeyboardShortcuts(editor, { platform }) };
}

function key(init: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true, ...init });
}

test('shortcuts use descending priority, installation ties and explicit fallback', () => {
  const calls: string[] = [];

  const { dispatch } = fixture(
    [
      { name: 'default', priority: -100, handled: true },
      { name: 'first', priority: 10, handled: false },
      { name: 'second', priority: 10, handled: true },
      { name: 'last', priority: 10, handled: true },
    ].map(({ name, priority, handled }) => ({
      key: 'Mod-b',
      priority,
      run() {
        calls.push(name);

        return handled;
      },
    })),
  );

  const event = key();
  expect(dispatch(event)).toBe(true);
  expect(calls).toEqual(['first', 'second']);
  expect(event.defaultPrevented).toBe(true);
  expect(dispatch(event)).toBe(true);
  expect(calls).toEqual(['first', 'second']);
});

test('declined keys retain their native default and Mod follows the selected platform', () => {
  for (const platform of ['mac', 'other'] as const) {
    const { dispatch } = fixture([{ key: 'Mod-Shift-b', run: () => true }], platform);

    const event = key({
      key: 'B',
      ctrlKey: platform === 'other',
      metaKey: platform === 'mac',
      shiftKey: true,
    });

    expect(dispatch(event)).toBe(true);

    for (const changes of [{ altKey: true }, { shiftKey: false }, { key: 'z' }]) {
      const unhandled = key({
        ctrlKey: platform === 'other',
        metaKey: platform === 'mac',
        shiftKey: true,
        ...changes,
      });

      expect(dispatch(unhandled)).toBe(false);
      expect(unhandled.defaultPrevented).toBe(false);
    }
  }

  const { dispatch } = fixture([{ key: 'Mod-b', run: () => false }]);
  const event = key();
  expect(dispatch(event)).toBe(false);
  expect(event.defaultPrevented).toBe(false);
});

test('composition, AltGraph and previously handled events never invoke shortcuts', () => {
  let calls = 0;

  const { dispatch } = fixture([
    {
      key: 'Control-b',
      run() {
        calls++;

        return true;
      },
    },
  ]);

  for (const event of [
    key({ isComposing: true }),
    key({ keyCode: 229 }),
    key({ modifierAltGraph: true }),
  ])
    expect(dispatch(event)).toBe(false);
  const consumed = key();
  consumed.preventDefault();
  expect(dispatch(consumed)).toBe(true);
  expect(calls).toBe(0);
});

test('shortcut errors consume the event, propagate and never call a fallback', () => {
  let fallback = false;

  const { dispatch } = fixture([
    {
      key: 'Control-b',
      run() {
        throw new Error('Extension failed');
      },
    },
    {
      key: 'Control-b',
      run() {
        fallback = true;

        return true;
      },
    },
  ]);

  const event = key();
  expect(() => dispatch(event)).toThrow('Extension failed');
  expect(event.defaultPrevented).toBe(true);
  expect(fallback).toBe(false);
});

test('shortcut assembly rejects ambiguous modifiers and invalid priorities', () => {
  for (const binding of ['Control-Control-b', 'Mod-Control-b', 'Unknown-b', 'Control-'])
    expect(() => fixture([{ key: binding, run: () => true }])).toThrow(/shortcut/i);
  expect(() => fixture([{ key: 'b', priority: Infinity, run: () => true }])).toThrow(/priority/);
});

test('dispatchers are session scoped and cannot outlive their editor', () => {
  let firstCalls = 0;

  const first = fixture([
    {
      key: 'Control-b',
      run() {
        firstCalls++;

        return true;
      },
    },
  ]);

  const second = fixture([]);
  first.dispatch(key());
  expect(second.dispatch(key())).toBe(false);
  expect(firstCalls).toBe(1);
  first.editor.destroy();
  expect(() => first.dispatch(key())).toThrow('Editor is destroyed');
  expect(second.dispatch(key())).toBe(false);
});
