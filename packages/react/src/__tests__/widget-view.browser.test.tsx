import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { createSchema, defineNode } from '@kerned/model';
import { NodeSelection, TextSelection, textSelection, type NodeAccess } from '@kerned/state';
import { decorations, type Decoration, type InvalidateDecorations } from '@kerned/view';
import {
  defineNodePresentation,
  presentations,
  mountEditor,
  type MountedEditor,
} from '@kerned/view';
import { createContext, StrictMode, useContext, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, expectTypeOf, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';

import { defineReactWidgetView, EditorContent, type ReactWidgetViewProps } from '../index.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.object({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const Theme = createContext('missing');

const Render = createContext(() => {});

function Review({ data, node, access, selection }: ReactWidgetViewProps<{ label: string }>) {
  const theme = useContext(Theme);
  const render = useContext(Render);
  const [count, setCount] = useState(0);
  expectTypeOf(data.label).toEqualTypeOf<string>();
  useLayoutEffect(render);

  return (
    <button
      onFocus={(event) => event.stopPropagation()}
      onBlur={(event) => event.stopPropagation()}
      data-widget={node.id}
      data-selection={selection.kind}
      data-access={access}
      style={{ pointerEvents: 'auto' }}
      onClick={() => setCount((value) => value + 1)}
    >
      {theme}:{data.label}:{count}
    </button>
  );
}

const review = defineReactWidgetView(Review);

const editorStyle = { width: 380, height: 400 };

test('node-local widget sources still receive permission changes without explicit decoration invalidation', async ({
  onTestFinished,
}) => {
  let writable = true;
  const f = fixture(() => (writable ? 'editable' : 'read-only'));
  onTestFinished(() => f.destroy());
  f.show();
  await f.whenReady;
  const button = f.element.querySelector<HTMLElement>('[data-widget]');

  if (!button) throw new Error('Missing widget');
  writable = false;
  f.editor.refreshPermissions();
  await expect.poll(() => button.dataset.access).toBe('read-only');
  expect(f.element.querySelector('[data-widget]')).toBe(button);
  const count = f.renders;
  f.editor.refreshPermissions();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(f.renders).toBe(count);
});

function fixture(access: (id: number) => NodeAccess = () => 'editable') {
  let values: readonly Decoration[] = [
    review({ key: 'review', at: { kind: 'text', offset: 4 }, data: { label: 'Review' } }),
  ];

  const listeners = new Set<InvalidateDecorations>();

  const rendering = defineExtension({
    name: 'rendering',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(
        presentations,
        defineNodePresentation(note, () => (attrs) => ({
          kind: 'text',
          text: attrs.text,
          size: 18,
          lineHeight: 28,
          before: 0,
          after: 16,
          baselineGrid: 4,
          spans: [],
          atoms: [],
        })),
      );
      context.provide(decorations, {
        name: 'review',
        dependencies: 'node',
        create() {
          return {
            read: (id) => (id === 1 ? values : []),
            subscribe(listener) {
              listeners.add(listener);

              return () => {
                listeners.delete(listener);
              };
            },
          };
        },
      });

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [note, rendering] }),
    permissions: { access: (node) => access(node.id) },
    content: Array.from({ length: 100 }, (_, index) => ({
      kind: 'note' as const,
      id: index + 1,
      text: `Paragraph ${index}. More editable content here.`,
    })),
  });

  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  let renders = 0;

  const callbacks = {
    render(this: void) {
      renders++;
    },
  };

  let ready: ((view: MountedEditor) => void) | undefined;

  const whenReady = new Promise<MountedEditor>((resolve) => {
    ready = resolve;
  });

  return {
    editor,
    element,
    whenReady,
    get renders() {
      return renders;
    },
    get subscribers() {
      return listeners.size;
    },
    show(theme = 'Warm') {
      root.render(
        <StrictMode>
          <Theme.Provider value={theme}>
            <Render.Provider value={callbacks.render}>
              <EditorContent editor={editor} style={editorStyle} onReady={ready} />
            </Render.Provider>
          </Theme.Provider>
        </StrictMode>,
      );
    },
    change(next: readonly Decoration[]) {
      values = next;

      for (const listener of listeners) listener([1]);
    },
    destroy() {
      root.unmount();
      editor.destroy();
      element.remove();
    },
  };
}

test('React decoration widgets preserve context and keyed state, skip unrelated updates and clean up on replacement', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.show();
  await f.whenReady;
  const button = f.element.querySelector<HTMLButtonElement>('[data-widget]');

  if (!button) throw new Error('Ready fired before the widget committed');
  expect(button.textContent).toBe('Warm:Review:0');
  const selection = f.editor.state.selection;
  await userEvent.click(button);
  expect(button.textContent).toBe('Warm:Review:1');
  expect(f.editor.state.selection).toBe(selection);
  const before = f.renders;
  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceText', id: 2, from: 0, to: 0, text: 'Changed ' });

    return true;
  });
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(f.renders).toBe(before);
  f.change([review({ key: 'review', at: { kind: 'text', offset: 12 }, data: { label: 'Moved' } })]);
  await expect.poll(() => button.textContent).toBe('Warm:Moved:1');
  expect(f.element.querySelector('[data-widget]')).toBe(button);
  f.show('Cool');
  await expect.poll(() => button.textContent).toBe('Cool:Moved:1');
  const replacement = defineReactWidgetView(Review);
  f.change([
    replacement({ key: 'review', at: { kind: 'node', edge: 'end' }, data: { label: 'Replaced' } }),
  ]);
  await expect
    .poll(() => f.element.querySelector('[data-widget]')?.textContent)
    .toBe('Cool:Replaced:0');
  f.change([]);
  await expect.poll(() => f.element.querySelector('[data-widget]')).toBeNull();
});

test('focused widgets pin their block, culling drops local state and remounting reads external data', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.show();
  const view = await f.whenReady;
  const button = f.element.querySelector<HTMLButtonElement>('[data-widget]');

  if (!button) throw new Error('Missing widget');
  await userEvent.click(button);
  button.focus();
  expect(document.activeElement).toBe(button);
  f.editor.select(textSelection(100, 0));
  await view.reveal({ id: 100, offset: 0 });
  expect(button.isConnected).toBe(true);
  expect(document.activeElement).toBe(button);
  // Exercise a user focus transfer. Firefox emits no focus events for .blur()
  // in an inactive test document when other browser workers have focus.
  const elsewhere = document.createElement('button');
  elsewhere.textContent = 'Outside editor';
  elsewhere.style.cssText = 'position:fixed;right:0;top:0;';
  document.body.append(elsewhere);
  onTestFinished(() => elsewhere.remove());
  await userEvent.click(elsewhere);
  await expect.poll(() => button.isConnected).toBe(false);
  f.change([
    review({ key: 'review', at: { kind: 'text', offset: 8 }, data: { label: 'Persistent' } }),
  ]);
  f.editor.select(textSelection(1, 0));
  await view.reveal({ id: 1, offset: 0 });
  await expect
    .poll(() => f.element.querySelector('[data-widget]')?.textContent)
    .toBe('Warm:Persistent:0');
  view.destroy();
  expect(f.subscribers).toBe(0);
  await expect.poll(() => f.element.querySelector('[data-widget]')).toBeNull();
});

test('React widget registrations reject vanilla mounts without leaking decorations', async ({
  onTestFinished,
}) => {
  const f = fixture();
  f.element.style.cssText = 'width:380px;height:400px;';
  const view = mountEditor(f.element, { editor: f.editor });
  onTestFinished(() => {
    view.destroy();
    f.destroy();
  });
  await expect(view.ready).rejects.toThrow('React renderers require EditorContent');
  expect(f.subscribers).toBe(0);
  expect(f.element.children.length).toBe(0);
  expect(f.editor.isDestroyed).toBe(false);
});

function invalidData() {
  // @ts-expect-error Widget data follows the registered React component's props.
  review({ key: 'review', at: { kind: 'text', offset: 0 }, data: { label: 123 } });
}

void invalidData;

test('node-local widgets receive owning-node selection even when their decoration data is unchanged', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.show();
  await f.whenReady;
  const button = f.element.querySelector<HTMLElement>('[data-widget]');

  if (!button) throw new Error('Missing widget');
  expect(button.dataset.selection).toBe('caret');
  f.editor.select(new TextSelection({ id: 1, offset: 12 }, { id: 1, offset: 20 }));
  await expect.poll(() => button.dataset.selection).toBe('range');
  f.editor.select(new NodeSelection(1));
  await expect.poll(() => button.dataset.selection).toBe('node');
  f.editor.select(textSelection(2, 0));
  await expect.poll(() => button.dataset.selection).toBe('none');
  const count = f.renders;
  f.editor.select(textSelection(2, 4));
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(f.renders).toBe(count);
  expect(f.element.querySelector('[data-widget]')).toBe(button);
});
