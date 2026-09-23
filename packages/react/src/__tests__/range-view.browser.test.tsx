import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import {
  createSchema,
  defineNode,
  defineInline,
  defineMark,
  type NodeIdentity,
} from '@kerned/model';
import { NodeSelection, TextSelection, textSelection, type NodeAccess } from '@kerned/state';
import { viewLayers } from '@kerned/view';
import {
  defineNodePresentation,
  mountEditor,
  presentations,
  type MountedEditor,
} from '@kerned/view';
import { createContext, StrictMode, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, expectTypeOf, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';

import {
  defineReactInlineView,
  defineReactMarkView,
  EditorContent,
  type ReactInlineViewProps,
  type ReactMarkViewProps,
  type EditorContentProps,
} from '../index.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text', marks: 'marks', inline: 'inline' },
  }),
});

const badge = defineInline(
  {
    name: 'badge',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.strictObject({ label: z.string().default('Badge') }) }),
  },
  (attrs) => attrs.label,
);

const highlight = defineMark({
  name: 'highlight',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({ color: z.string().default('gold') }) }),
});

const Application = createContext({ theme: 'missing', render: (_kind: string) => {} });

function Badge({
  attributes,
  id,
  index,
  width,
  height,
  access,
  selection,
}: ReactInlineViewProps<typeof badge>) {
  const application = useContext(Application);
  const [count, setCount] = useState(0);
  expectTypeOf(attributes.label).toEqualTypeOf<string>();
  useLayoutEffect(() => application.render('inline'));

  return (
    <button
      data-badge={id}
      data-selection={selection.kind}
      data-access={access}
      data-index={index}
      style={{ width, height, pointerEvents: 'auto' }}
      onClick={() => setCount((value) => value + 1)}
    >
      {application.theme}:{attributes.label}:{count}
    </button>
  );
}

function Highlight({
  attributes,
  fragments,
  access,
  selection,
}: ReactMarkViewProps<typeof highlight>) {
  const application = useContext(Application);
  expectTypeOf(attributes.color).toEqualTypeOf<string>();
  useLayoutEffect(() => application.render('mark'));

  return (
    <>
      {fragments.map((fragment, index) => (
        <span
          key={`${fragment.top}:${fragment.left}`}
          data-mark-fragment={index}
          data-selection={selection.kind}
          data-access={access}
          data-theme={application.theme}
          style={{
            position: 'absolute',
            pointerEvents: 'auto',
            ...fragment,
            background: attributes.color,
            opacity: 0.3,
          }}
        />
      ))}
    </>
  );
}

const rendering = defineExtension({
  name: 'rendering',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(note, () => (attrs, { inline }) => ({
        kind: 'text',
        text: attrs.text,
        size: 18,
        lineHeight: 28,
        before: 0,
        after: 16,
        baselineGrid: 4,
        spans: [],
        atoms: inline.map((value) => ({
          id: value.id,
          index: value.index,
          label: 'Badge',
          width: 160,
          ascent: 24,
          descent: 4,
        })),
      })),
    );
    context.provide(viewLayers, defineReactInlineView(badge, Badge));
    context.provide(viewLayers, defineReactMarkView(highlight, Highlight));

    return {};
  },
});

const schema = createSchema({ extensions: [note, badge, highlight, rendering] });

test('inline and mark access updates propagate without document mutation or unrelated renderer updates', async ({
  onTestFinished,
}) => {
  const access = new Map<number, NodeAccess>();
  const f = fixture(false, (id) => access.get(id) ?? 'editable');
  onTestFinished(() => f.destroy());
  f.show();
  await f.ready;
  const button = f.element.querySelector<HTMLElement>('[data-badge]');
  const mark = f.element.querySelector<HTMLElement>('[data-mark-fragment]');

  if (!button || !mark) throw new Error('Missing range views');
  const before = f.editor.state;
  const inlineRenders = f.renders.filter((kind) => kind === 'inline').length;
  access.set(2, 'read-only');
  f.editor.refreshPermissions();
  await expect.poll(() => mark.dataset.access).toBe('read-only');
  expect(f.renders.filter((kind) => kind === 'inline').length).toBe(inlineRenders);
  expect(button.dataset.access).toBe('editable');
  access.set(1, 'protected');
  f.editor.refreshPermissions();
  await expect.poll(() => button.dataset.access).toBe('protected');
  expect(f.element.querySelector('[data-badge]')).toBe(button);
  expect(f.editor.state.nodes).toBe(before.nodes);
});

const prose = 'Wrapped marked text should remain selectable across every line. '.repeat(8);

function FixtureContent<N extends NodeIdentity>({
  editor,
  theme,
  width,
  render,
  onReady,
}: {
  editor: EditorContentProps<N>['editor'];
  theme: string;
  width: number;
  render: (kind: string) => void;
  onReady: (view: MountedEditor) => void;
}) {
  const application = useMemo(() => ({ theme, render }), [theme, render]);
  const style = useMemo(() => ({ width, height: 400 }), [width]);

  return (
    <StrictMode>
      <Application.Provider value={application}>
        <EditorContent editor={editor} style={style} onReady={onReady} />
      </Application.Provider>
    </StrictMode>
  );
}

function fixture(long = false, access: (id: number) => NodeAccess = () => 'editable') {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);

  const editor = createEditor({
    schema,
    permissions: { access: (node) => access(node.id) },
    content: [
      {
        id: 1,
        kind: 'note',
        text: '\ufffc Inline content.',
        inline: [{ id: 'badge:1', index: 0, type: 'badge', attrs: {} }],
      },
      {
        id: 2,
        kind: 'note',
        text: prose,
        marks: [{ from: 0, to: 240, mark: { type: 'highlight', attrs: {} } }],
      },
      ...Array.from({ length: long ? 100 : 1 }, (_, index) => ({
        id: index + 3,
        kind: 'note' as const,
        text: `Paragraph ${index}.`,
      })),
    ],
  });

  const renders: string[] = [];
  let resolve: ((view: MountedEditor) => void) | undefined;

  const ready = new Promise<MountedEditor>((value) => {
    resolve = value;
  });

  const callbacks = {
    render(this: void, kind: string) {
      renders.push(kind);
    },
    ready(this: void, view: MountedEditor) {
      resolve?.(view);
    },
  };

  return {
    element,
    editor,
    renders,
    ready,
    show(theme = 'Warm', width = 380) {
      root.render(
        <FixtureContent
          editor={editor}
          theme={theme}
          width={width}
          render={callbacks.render}
          onReady={callbacks.ready}
        />,
      );
    },
    destroy() {
      root.unmount();
      editor.destroy();
      element.remove();
    },
  };
}

test('React inline and wrapped mark views preserve context, types, local state and unchanged-node rendering', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.show();
  await f.ready;
  const button = f.element.querySelector<HTMLButtonElement>('[data-badge]');

  if (!button) throw new Error('Missing inline view');
  expect(button.textContent).toBe('Warm:Badge:0');
  expect(f.element.querySelectorAll('[data-mark-fragment]').length).toBeGreaterThan(2);
  const selection = f.editor.state.selection;
  await userEvent.click(button);
  expect(button.textContent).toBe('Warm:Badge:1');
  expect(f.editor.state.selection).toBe(selection);
  const before = f.renders.length;
  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceText', id: 3, from: 0, to: 0, text: 'Unrelated ' });

    return true;
  });
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  );
  expect(f.renders.length).toBe(before);
  f.show('Cool');
  await expect.poll(() => button.textContent).toBe('Cool:Badge:1');
  expect(f.element.querySelector('[data-mark-fragment]')?.getAttribute('data-theme')).toBe('Cool');
  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'Before ' });

    return true;
  });
  await expect.poll(() => button.dataset.index).toBe('7');
  expect(f.element.querySelector('[data-badge]')).toBe(button);
  expect(button.textContent).toBe('Cool:Badge:1');
});

test('mark fragments follow wrapping and clicks select canvas text rather than a whole node', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.show();
  await f.ready;
  const original = f.element.querySelectorAll('[data-mark-fragment]').length;
  f.show('Warm', 700);
  await expect
    .poll(() => f.element.querySelectorAll('[data-mark-fragment]').length)
    .toBeLessThan(original);
  const fragment = f.element.querySelector<HTMLElement>('[data-mark-fragment]');

  if (!fragment) throw new Error('Missing mark view');
  await userEvent.click(fragment);
  expect(f.editor.state.selection.type).toBe('text');
  expect(f.editor.state.selection).toMatchObject({ head: { id: 2 } });
});

test('focused inline controls remain mounted until focus leaves, then culling preserves document state', async ({
  onTestFinished,
}) => {
  const f = fixture(true);
  onTestFinished(() => f.destroy());
  f.show();
  const view = await f.ready;
  const button = f.element.querySelector<HTMLButtonElement>('[data-badge]');

  if (!button) throw new Error('Missing inline view');
  button.focus();
  f.editor.select(textSelection(102, 0));
  await view.reveal({ id: 102, offset: 0 });
  expect(document.activeElement).toBe(button);
  expect(button.isConnected).toBe(true);
  button.blur();
  await expect.poll(() => button.isConnected).toBe(false);
  f.editor.select(textSelection(1, 0));
  await view.reveal({ id: 1, offset: 0 });
  await expect
    .poll(() => f.element.querySelector('[data-badge]')?.textContent)
    .toBe('Warm:Badge:0');
  expect(f.editor.state.nodes[0]).toMatchObject({ inline: [{ attrs: { label: 'Badge' } }] });
});

test('a vanilla mount rejects React range views and releases its DOM without destroying the editor', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const view = mountEditor(f.element, { editor: f.editor });
  onTestFinished(() => view.destroy());
  await expect(view.ready).rejects.toThrow(/require EditorContent/);
  expect(view.status).toBe('failed');
  expect(f.element.children.length).toBe(0);
  expect(f.editor.isDestroyed).toBe(false);
});

test('inline and wrapped mark renderers receive scoped selection without remounting or unrelated renders', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.show();
  await f.ready;
  const button = f.element.querySelector<HTMLElement>('[data-badge]');
  const mark = f.element.querySelector<HTMLElement>('[data-mark-fragment]');

  if (!button || !mark) throw new Error('Missing range views');
  f.editor.select(textSelection(2, 4));
  await expect.poll(() => mark.dataset.selection).toBe('caret');
  expect(button.dataset.selection).toBe('none');
  const inlineCount = f.renders.filter((kind) => kind === 'inline').length;
  f.editor.select(new TextSelection({ id: 2, offset: 4 }, { id: 2, offset: 12 }));
  await expect.poll(() => mark.dataset.selection).toBe('range');
  expect(f.renders.filter((kind) => kind === 'inline').length).toBe(inlineCount);
  f.editor.select(textSelection(2, 300));
  await expect.poll(() => mark.dataset.selection).toBe('none');
  const count = f.renders.length;
  f.editor.select(textSelection(2, 320));
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(f.renders.length).toBe(count);
  f.editor.select(new TextSelection({ id: 1, offset: 0 }, { id: 1, offset: 1 }));
  await expect.poll(() => button.dataset.selection).toBe('range');
  f.editor.select(new NodeSelection(1));
  await expect.poll(() => button.dataset.selection).toBe('node');
  expect(f.element.querySelector('[data-badge]')).toBe(button);
  expect(f.element.querySelector('[data-mark-fragment]')).toBe(mark);
});
