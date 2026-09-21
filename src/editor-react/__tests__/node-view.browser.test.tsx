import {
  Component,
  type ReactNode,
  createContext,
  StrictMode,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, expectTypeOf, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';

import {
  createEditor,
  defineExtension,
  type CommandDefinition,
  type ContributionContext,
} from '../../core';
import { nodeViews } from '../../editor-browser';
import {
  defineNodePresentation,
  mountEditor,
  presentations,
  type MountedEditor,
} from '../../editor-canvas';
import { createSchema, defineNode, type DocumentNode, type NodeIdentity } from '../../model';
import { NodeSelection, textSelection, type AccessPolicy } from '../../state';
import { defineReactNodeView, EditorContent, type ReactNodeViewProps } from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const card = defineNode({
  name: 'card',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ label: z.string(), height: z.number().default(72) }),
    content: { kind: 'atom' },
  }),
});

type Node = DocumentNode<readonly [typeof note, typeof card]>;

const rename: CommandDefinition<Node, [number, string]> = {
  execute(context, id, label) {
    const node = context.state.nodes.find((value) => value.id === id);

    if (!node || node.kind !== 'card') return false;
    context.step({ kind: 'updateBlock', node: { ...node, label } });

    return true;
  },
};

const controls = defineExtension({
  name: 'controls',
  options: {},
  setup: () => ({ commands: { rename } }),
});

const Application = createContext<{
  theme: string;
  rename: (id: number, value: string) => void;
  mounted: (id: number) => () => void;
  rendered: (id: number) => void;
} | null>(null);

function Card({ node, attributes, selection, access }: ReactNodeViewProps<typeof card>) {
  const application = useContext(Application);

  if (!application) throw new Error('Application context was lost');

  if (application.theme === 'Throw') throw new Error('Custom render failed');
  const { theme, rename: renameCard, mounted, rendered } = application;
  const [clicks, setClicks] = useState(0);
  expectTypeOf(node).toEqualTypeOf<Readonly<NodeIdentity>>();
  expectTypeOf(attributes.label).toEqualTypeOf<string>();
  expectTypeOf(attributes.height).toEqualTypeOf<number>();
  useEffect(() => mounted(node.id), [mounted, node.id]);
  useLayoutEffect(() => rendered(node.id));

  return (
    <section
      data-access={access}
      data-card={node.id}
      data-selected={selection.kind === 'node'}
      style={{ height: attributes.height }}
    >
      <span>
        {theme}:{attributes.label}
      </span>
      <button onClick={() => setClicks((value) => value + 1)}>Count {clicks}</button>
      <button disabled={access !== 'editable'} onClick={() => renameCard(node.id, 'Saved')}>
        Rename
      </button>
    </section>
  );
}

const cardRenderer = defineReactNodeView(card, Card);

test('React node views receive live effective access without remounting or remeasuring unrelated content', async ({
  onTestFinished,
}) => {
  let writable = true;
  const f = fixture(false, { access: () => (writable ? 'editable' : 'read-only') });
  onTestFinished(() => f.destroy());
  f.root.render(
    <Application.Provider value={f.application}>
      <EditorContent editor={f.editor} style={size} onReady={f.ready} />
    </Application.Provider>,
  );
  const view = await f.readiness;
  const element = f.element.querySelector<HTMLElement>('[data-card]');
  const renameButton = element?.querySelectorAll('button')[1];

  if (!element || !renameButton) throw new Error('Missing card');
  const before = f.editor.state;
  const bounds = view.blockBounds(f.editor.state.nodes[1].id);
  writable = false;
  f.editor.refreshPermissions();
  await expect.poll(() => element.dataset.access).toBe('read-only');
  expect(renameButton.disabled).toBe(true);
  expect(f.element.querySelector('[data-card]')).toBe(element);
  expect(view.blockBounds(f.editor.state.nodes[1].id)).toEqual(bounds);
  expect(f.editor.state.nodes).toBe(before.nodes);
  const count = f.renders.length;
  f.editor.refreshPermissions();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(f.renders.length).toBe(count);
  writable = true;
  f.editor.refreshPermissions();
  await expect.poll(() => renameButton.disabled).toBe(false);
});

const views = defineExtension({
  name: 'views',
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
    context.provide(
      presentations,
      defineNodePresentation(card, () => () => ({
        kind: 'box',
        height: 40,
        before: 0,
        after: 16,
        baselineGrid: 4,
      })),
    );
    context.provide(nodeViews, cardRenderer);

    return {};
  },
});

const schema = createSchema({ extensions: [note, card, controls, views] });

const size = { width: 420, height: 280 };

function fixture(long = false, permissions?: AccessPolicy<Node>) {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);

  const editor = createEditor({
    schema,
    permissions,
    content: [
      { kind: 'note', text: 'Canvas text above the widget.' },
      { kind: 'card', label: 'Original' },
      ...Array.from(
        { length: long ? 90 : 1 },
        (_, index) => ({ kind: 'note', text: `Paragraph ${index}` }) as const,
      ),
    ],
  });

  const live = new Set<number>();
  const renders: number[] = [];
  const clicks: string[] = [];
  let ready: ((view: MountedEditor) => void) | undefined;

  const readiness = new Promise<MountedEditor>((resolve) => {
    ready = resolve;
  });

  const application = {
    theme: 'Warm',
    rename: editor.commands.rename,
    mounted(id: number) {
      live.add(id);

      return () => {
        live.delete(id);
      };
    },
    rendered(id: number) {
      renders.push(id);
    },
  };

  return {
    editor,
    element,
    root,
    readiness,
    live,
    renders,
    application,
    clicks,
    click(this: void) {
      clicks.push('host');
    },
    withTheme(theme: string) {
      return { ...application, theme };
    },
    ready(this: void, view: MountedEditor) {
      ready?.(view);
    },
    destroy() {
      flushSync(() => root.unmount());
      editor.destroy();
      element.remove();
    },
  };
}

test('React nodes share host context, preserve local state, measure height and keep buttons interactive', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  flushSync(() =>
    f.root.render(
      <StrictMode>
        <Application.Provider value={f.application}>
          <EditorContent editor={f.editor} style={size} onReady={f.ready} onClick={f.click} />
        </Application.Provider>
      </StrictMode>,
    ),
  );
  const view = await f.readiness;
  const id = f.editor.state.nodes[1].id;
  expect(f.element.querySelector('[data-card] span')?.textContent).toBe('Warm:Original');
  await expect.poll(() => view.blockBounds(id)?.height).toBe(72);
  const renderCount = f.renders.length;
  const textId = f.editor.state.nodes[0].id;
  f.editor.select(textSelection(textId, 2));
  await view.reveal({ id: textId, offset: 2 });
  expect(f.renders.length).toBe(renderCount);
  const beforeSelection = f.editor.state.selection;
  const count = f.element.querySelector<HTMLButtonElement>('[data-card] button');

  if (!count) throw new Error('Missing React button');
  await userEvent.click(count);
  expect(count.textContent).toBe('Count 1');
  expect(f.clicks).toEqual(['host']);
  expect(f.editor.state.selection).toBe(beforeSelection);
  const changed = f.withTheme('Cool');
  flushSync(() =>
    f.root.render(
      <StrictMode>
        <Application.Provider value={changed}>
          <EditorContent editor={f.editor} style={size} onReady={f.ready} onClick={f.click} />
        </Application.Provider>
      </StrictMode>,
    ),
  );
  expect(f.element.querySelector('[data-card] span')?.textContent).toBe('Cool:Original');
  expect(count.textContent).toBe('Count 1');
  const renameButton = f.element.querySelectorAll<HTMLButtonElement>('[data-card] button')[1];
  await userEvent.click(renameButton);
  await expect
    .poll(() => f.element.querySelector('[data-card] span')?.textContent)
    .toBe('Cool:Saved');
  expect(count.textContent).toBe('Count 1');
  f.editor.select(new NodeSelection(id));
  await expect
    .poll(() => f.element.querySelector('[data-card]')?.getAttribute('data-selected'))
    .toBe('true');
  expect(f.live.has(id)).toBe(true);
  flushSync(() => f.root.render(null));
  expect(f.live.size).toBe(0);
  expect(view.isDestroyed).toBe(true);
  expect(f.editor.isDestroyed).toBe(false);
});

test('culling releases React effects while document state survives remounting', async ({
  onTestFinished,
}) => {
  const f = fixture(true);
  onTestFinished(() => f.destroy());
  flushSync(() =>
    f.root.render(
      <Application.Provider value={f.application}>
        <EditorContent editor={f.editor} style={size} onReady={f.ready} onClick={f.click} />
      </Application.Provider>,
    ),
  );
  const view = await f.readiness;
  const cardId = f.editor.state.nodes[1].id;
  await expect.poll(() => f.live.has(cardId)).toBe(true);
  f.editor.commands.rename(cardId, 'Persisted');
  await expect
    .poll(() => f.element.querySelector('[data-card] span')?.textContent)
    .toBe('Warm:Persisted');
  const last = f.editor.state.nodes.at(-1);

  if (!last) throw new Error('Missing last node');
  f.editor.select(textSelection(last.id, 0));
  await view.reveal({ id: last.id, offset: 0 });
  await expect.poll(() => f.element.querySelector('[data-card]')).toBeNull();
  expect(f.live.size).toBe(0);
  f.editor.select(textSelection(f.editor.state.nodes[0].id, 0));
  await view.reveal({ id: f.editor.state.nodes[0].id, offset: 0 });
  await expect
    .poll(() => f.element.querySelector('[data-card] span')?.textContent)
    .toBe('Warm:Persisted');
  expect(f.live.has(cardId)).toBe(true);
});

test('React node registration requires a React content host instead of creating an isolated root', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const view = mountEditor(f.element, { editor: f.editor });
  onTestFinished(() => view.destroy());
  await expect(view.ready).rejects.toThrow(/React renderers require EditorContent/);
  expect(f.element.querySelector('canvas')).toBeNull();
  expect(f.editor.isDestroyed).toBe(false);
});

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>Render failed</p> : this.props.children;
  }
}

test('custom node errors reach the application boundary and release native and React resources', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  flushSync(() =>
    f.root.render(
      <Boundary>
        <Application.Provider value={f.application}>
          <EditorContent editor={f.editor} style={size} onReady={f.ready} />
        </Application.Provider>
      </Boundary>,
    ),
  );
  const view = await f.readiness;
  const failure = f.withTheme('Throw');
  flushSync(() =>
    f.root.render(
      <Boundary>
        <Application.Provider value={failure}>
          <EditorContent editor={f.editor} style={size} onReady={f.ready} />
        </Application.Provider>
      </Boundary>,
    ),
  );
  expect(f.element.textContent).toBe('Render failed');
  expect(f.element.querySelector('canvas')).toBeNull();
  expect(f.live.size).toBe(0);
  expect(view.isDestroyed).toBe(true);
  expect(f.editor.isDestroyed).toBe(false);
});

test('two React editors with overlapping node IDs retain independent context and cleanup', async ({
  onTestFinished,
}) => {
  const first = fixture();
  const second = fixture();
  onTestFinished(() => {
    first.destroy();
    second.destroy();
  });
  const cool = second.withTheme('Cool');
  flushSync(() => {
    first.root.render(
      <Application.Provider value={first.application}>
        <EditorContent editor={first.editor} style={size} onReady={first.ready} />
      </Application.Provider>,
    );
    second.root.render(
      <Application.Provider value={cool}>
        <EditorContent editor={second.editor} style={size} onReady={second.ready} />
      </Application.Provider>,
    );
  });
  const a = await first.readiness;
  const b = await second.readiness;
  expect(first.element.querySelector('[data-card] span')?.textContent).toBe('Warm:Original');
  expect(second.element.querySelector('[data-card] span')?.textContent).toBe('Cool:Original');
  flushSync(() => first.root.render(null));
  expect(a.isDestroyed).toBe(true);
  expect(b.isDestroyed).toBe(false);
  second.editor.commands.rename(second.editor.state.nodes[1].id, 'Still here');
  await expect
    .poll(() => second.element.querySelector('[data-card] span')?.textContent)
    .toBe('Cool:Still here');
  expect(first.live.size).toBe(0);
  expect(second.live.size).toBe(1);
});
