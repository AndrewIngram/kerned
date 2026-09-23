import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { createSchema, defineNode } from '@kerned/model';
import { textSelection } from '@kerned/state';
import {
  decorations,
  defineWidgetView,
  defineNodeView,
  nodeViews,
  type Decoration,
} from '@kerned/view';
import { defineNodePresentation, mountEditor, presentations } from '@kerned/view';
import { createViewDiagnostics } from '@kerned/view/diagnostics';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';

const note = defineNode({
  name: 'note',
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
    attributes: z.object({ indent: z.number().nonnegative() }),
    content: { kind: 'container', field: 'children', allowedGroups: ['block'] },
  }),
});

const card = defineNode({
  name: 'card',
  version: 1,
  options: {},
  schema: () => ({
    groups: ['block'],
    attributes: z.object({}),
    content: { kind: 'container', field: 'children', allowed: ['note'] },
  }),
});

const label = defineWidgetView<null>((element) => {
  element.dataset.edgeWidget = '';

  return {
    update({ anchor }) {
      element.style.minWidth = `${anchor.width}px`;
    },
    destroy() {},
  };
});

const rendering = defineExtension({
  name: 'rendering',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(note, () => (attributes) => ({
        kind: 'text',
        text: attributes.text,
        size: 16,
        lineHeight: 24,
        before: 0,
        after: 12,
        baselineGrid: 0,
        spans: [],
        atoms: [],
      })),
    );
    context.provide(
      presentations,
      defineNodePresentation(group, () => (attributes) => ({
        kind: 'flow',
        child: (_index, inherited) => ({ inset: inherited.inset + attributes.indent }),
      })),
    );
    context.provide(
      presentations,
      defineNodePresentation(card, () => () => ({
        kind: 'box',
        height: 40,
        before: 0,
        after: 12,
        baselineGrid: 0,
      })),
    );
    context.provide(
      nodeViews,
      defineNodeView(card, () => (element) => ({
        update({ node, width, onMeasure }) {
          element.dataset.card = String(node.id);
          element.style.height = `${width / 2}px`;
          onMeasure(node.id, width, width / 2);
        },
        destroy() {},
      })),
    );

    context.provide(decorations, {
      name: 'edge',
      dependencies: 'node',
      create() {
        const values = [
          label({ key: 'edge', at: { kind: 'node', edge: 'start' }, data: null }),
          {
            kind: 'node',
            key: 'outline',
            outline: { color: 'red', width: 1, radius: 4 },
            attributes: { 'data-card-outline': '' },
          },
        ] satisfies readonly Decoration[];

        return { read: (id) => (id === 4 ? values : []), subscribe: () => () => {} };
      },
    });

    return {};
  },
});

const groupViewOptions = { enabled: true };

const groupViews = defineExtension({
  name: 'group-views',
  options: groupViewOptions,
  setup(options, context: ContributionContext) {
    if (!options.enabled) return {};
    context.provide(
      nodeViews,
      defineNodeView(group, () => (element) => {
        element.style.cssText =
          'display:flow-root;background:rgb(245, 235, 220);padding:10px 12px 14px 16px;box-sizing:border-box';
        const header = document.createElement('button');
        header.textContent = 'Expand header';
        header.style.cssText = 'display:block;height:20px;padding:0;border:0';
        header.addEventListener('click', () => {
          header.style.height = '60px';
        });
        const body = document.createElement('div');
        body.dataset.slotBody = '';
        element.append(header, body);
        let release: (() => void) | undefined;

        return {
          update({ node, content }) {
            element.dataset.group = String(node.id);

            if (!release && content) release = content.attach(body);
          },
          destroy() {
            release?.();
          },
        };
      }),
    );

    return {};
  },
});

function fixture(slots = false, decorateFlows = false) {
  const activated: number[] = [];

  const flowDecorations = defineExtension({
    name: 'flow-decorations',
    options: {},
    setup(_options, context: ContributionContext) {
      if (decorateFlows)
        context.provide(decorations, {
          name: 'containers',
          dependencies: 'node',
          create() {
            return {
              read(id) {
                if (id !== 1 && id !== 6) return [];

                return [
                  label({ key: 'flow-edge', at: { kind: 'node', edge: 'end' }, data: null }),
                  {
                    kind: 'node',
                    key: 'flow-outline',
                    outline: { color: 'blue', width: 1, radius: 4 },
                    attributes: { 'data-flow-outline': String(id) },
                    activation: {
                      label: 'Select container',
                      onActivate: () => {
                        activated.push(id);
                      },
                    },
                  },
                ];
              },
              subscribe: () => () => {},
            };
          },
        });

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({
      extensions: [
        note,
        group,
        card,
        rendering,
        groupViews.configure({ enabled: slots }),
        flowDecorations,
      ],
    }),
    content: [
      { kind: 'note', id: 0, text: 'Before' },
      {
        kind: 'group',
        id: 1,
        indent: 24,
        children: [
          { kind: 'note', id: 2, text: 'First descendant' },
          {
            kind: 'group',
            id: 3,
            indent: 16,
            children: [
              { kind: 'card', id: 4, children: [{ kind: 'note', id: 8, text: 'Native content' }] },
              { kind: 'note', id: 5, text: 'Last descendant. '.repeat(8) },
            ],
          },
          { kind: 'group', id: 6, indent: 16, children: [] },
        ],
      },
      { kind: 'note', id: 7, text: 'After' },
    ],
  });

  const element = document.createElement('div');
  element.style.cssText = 'width:420px;height:180px';
  document.body.append(element);
  const diagnostics = createViewDiagnostics();
  const view = mountEditor(element, { editor, diagnostics });

  return {
    editor,
    element,
    view,
    diagnostics,
    activated,
    destroy() {
      view.destroy();
      editor.destroy();
      element.remove();
    },
  };
}

test('flow bounds span nested descendants and native views use their inherited width for positioning and measurement', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  await f.view.ready;
  await expect.poll(() => f.view.blockBounds(4)?.height).toBe(162);

  const first = f.view.blockBounds(2),
    last = f.view.blockBounds(5);

  if (!first || !last) throw new Error('Missing descendants');
  expect(f.view.blockBounds(1)).toEqual({
    id: 1,
    left: 28,
    top: first.top,
    width: 364,
    height: last.top + last.height - first.top,
  });
  expect(f.view.blockBounds(3)).toMatchObject({ id: 3, left: 52, width: 340 });
  expect(f.view.blockBounds(4)).toMatchObject({ id: 4, left: 68, width: 324 });
  expect(f.view.blockBounds(8)).toEqual(f.view.blockBounds(4));
  expect(f.view.blockBounds(6)).toMatchObject({ id: 6, height: 0 });
  const native = f.element.querySelector<HTMLElement>('[data-card]');
  const bounds = f.view.blockBounds(4, 'client');

  if (!native || !bounds) throw new Error('Missing native view');
  expect(native.getBoundingClientRect().left).toBeCloseTo(bounds.left);
  expect(native.getBoundingClientRect().width).toBeCloseTo(bounds.width);
  expect(native.getBoundingClientRect().height).toBeCloseTo(bounds.height);
  const widget = f.element.querySelector<HTMLElement>('[data-edge-widget]');

  if (!widget) throw new Error('Missing node-edge widget');
  expect(widget.getBoundingClientRect().left).toBeCloseTo(bounds.left);
  expect(widget.getBoundingClientRect().width).toBeCloseTo(bounds.width);
  const outline = f.element.querySelector<HTMLElement>('[data-card-outline]');

  if (!outline) throw new Error('Missing node outline');
  expect(outline.getBoundingClientRect().left).toBeCloseTo(bounds.left);
  expect(outline.getBoundingClientRect().width).toBeCloseTo(bounds.width);
  f.view.update({ zoom: 1.5 });
  await expect.poll(() => f.view.blockBounds(4)?.height).toBe(92);
  const zoomed = f.view.blockBounds(4, 'client');

  if (!zoomed) throw new Error('Missing zoomed bounds');
  expect(native.getBoundingClientRect().left).toBeCloseTo(zoomed.left);
  expect(native.getBoundingClientRect().width).toBeCloseTo(zoomed.width);
  expect(native.getBoundingClientRect().height).toBeCloseTo(zoomed.height);
  expect(widget.getBoundingClientRect().left).toBeCloseTo(zoomed.left);
  expect(widget.getBoundingClientRect().width).toBeCloseTo(zoomed.width);
});

test('flow bounds follow edits, culling, scrolling and deletion without traversing or composing descendants on demand', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  await f.view.ready;
  await expect.poll(() => f.view.blockBounds(4)?.height).toBe(162);
  const before = f.view.blockBounds(1);

  if (!before) throw new Error('Missing container');

  const noteNode = f.editor.schema
    .node(note)
    .create({ id: 9, key: 'inserted' }, { text: 'Added '.repeat(200) });

  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceChildren', parent: 3, index: 1, count: 0, nodes: [noteNode] });

    return true;
  });
  expect(f.view.blockBounds(1)).toBeNull();
  await expect.poll(() => f.view.blockBounds(1)?.height ?? 0).toBeGreaterThan(before.height);
  f.editor.select(textSelection(5, 0));
  await f.view.reveal({ id: 5, offset: 0 });

  const outer = f.view.blockBounds(1),
    client = f.view.blockBounds(1, 'client');

  if (!outer || !client) throw new Error('Missing scrolled container');
  const canvas = f.element.querySelector('canvas');

  if (!canvas) throw new Error('Missing canvas');
  const scroll = f.view.getSnapshot()?.viewport.top ?? 0;
  expect(client.top).toBeCloseTo(canvas.getBoundingClientRect().top + outer.top - scroll);
  expect(f.view.blockBounds(5, 'client')?.top).toBeGreaterThanOrEqual(
    canvas.getBoundingClientRect().top,
  );
  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceChildren', parent: null, index: 1, count: 1, nodes: [] });

    return true;
  });
  await expect.poll(() => f.view.blockBounds(7)?.top).toBe(68);
  expect(f.view.blockBounds(1)).toBeNull();
  expect(f.view.blockBounds(3)).toBeNull();
});

test('vanilla content slots reserve nested chrome, preserve the canvas caret and remeasure after interaction and zoom', async ({
  onTestFinished,
}) => {
  const f = fixture(true);
  onTestFinished(() => f.destroy());
  await f.view.ready;
  await expect.poll(() => f.view.blockBounds(2)?.left).toBe(68);
  await expect.poll(() => f.view.blockBounds(4)?.width).toBe(268);
  const outer = f.element.querySelector<HTMLElement>('[data-group="1"]');
  const body = outer?.querySelector<HTMLElement>('[data-slot-body]');
  const button = outer?.querySelector('button');

  if (!outer || !body || !button) throw new Error('Missing slot chrome');
  const first = f.view.blockBounds(2, 'client');

  if (!first) throw new Error('Missing slot content');
  expect(first.top).toBeCloseTo(body.getBoundingClientRect().top);
  expect(first.left).toBeCloseTo(body.getBoundingClientRect().left + 24);
  const start = f.view.blockBounds(2)?.top ?? 0;
  const revision = f.editor.state.revision;
  button.focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => f.view.blockBounds(2)?.top).toBe(start + 40);
  expect(f.editor.state.revision).toBe(revision);
  expect(document.activeElement).toBe(button);
  expect(f.view.coordsAt({ id: 2, offset: 3 })?.top).toBeGreaterThanOrEqual(
    body.getBoundingClientRect().top,
  );
  f.view.update({ zoom: 1.25 });
  await expect.poll(() => f.view.blockBounds(4)?.width).toBe(184);
  const resized = f.view.blockBounds(2, 'client');

  if (!resized) throw new Error('Missing resized content');
  expect(resized.top).toBeCloseTo(body.getBoundingClientRect().top);
  expect(resized.left).toBeCloseTo(body.getBoundingClientRect().left + 24 * 1.25);
  await f.view.reveal({ id: 5, offset: 0 });
  await expect.poll(() => f.view.blockBounds(6)?.height).toBe(44);
  expect(f.element.querySelectorAll('canvas')).toHaveLength(1);
  expect(f.element.querySelectorAll('[data-editor-input]')).toHaveLength(1);
  const root = f.element.querySelector('[data-editor-content]');
  expect(root?.children[0].contains(outer)).toBe(true);
  expect(root?.children[1].tagName).toBe('CANVAS');
});

test('replacing a flowing node identity cancels the old slot and measures the successor', async ({
  onTestFinished,
}) => {
  const f = fixture(true);
  onTestFinished(() => f.destroy());
  await f.view.ready;
  await expect.poll(() => f.view.blockBounds(2)?.left).toBe(68);
  const old = f.element.querySelector<HTMLElement>('[data-group="1"]');

  if (!old) throw new Error('Missing original');
  old.style.paddingTop = '80px';

  const child = f.editor.schema
    .node(note)
    .create({ id: 9, key: 'new-child' }, { text: 'Replacement' });

  const replacement = f.editor.schema
    .node(group)
    .create({ id: 1, key: 'new-group' }, { indent: 0 }, [child]);

  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceChildren', parent: null, index: 1, count: 1, nodes: [] });

    return true;
  });
  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceChildren', parent: null, index: 1, count: 0, nodes: [replacement] });

    return true;
  });
  await expect.poll(() => f.view.blockBounds(9)?.top).toBe(98);
  const current = f.element.querySelector<HTMLElement>('[data-group="1"]');
  expect(current).not.toBe(old);
  expect(old.isConnected).toBe(false);
  const header = current?.querySelector('button');

  if (!header) throw new Error('Missing replacement header');
  header.style.height = '70px';
  await expect.poll(() => f.view.blockBounds(9)?.top).toBe(148);
});

test(
  'large nested slots keep geometry and residency correct during background reflow, subtree moves and edits',
  { timeout: 20_000 },
  async ({ onTestFinished }) => {
    const f = fixture(true);
    onTestFinished(() => f.destroy());
    await f.view.ready;
    await expect.poll(() => f.view.blockBounds(2)?.left).toBe(68);

    const sections = Array.from({ length: 16 }, (_, section) => {
      const id = 10000 + section * 257;

      const children = Array.from({ length: 256 }, (_unused, index) =>
        f.editor.schema.node(note).create(
          { id: id + index + 1, key: `section-${section}-note-${index}` },
          {
            text: `Section ${section}, paragraph ${index}. ${'Text reflows inside nested chrome. '.repeat(6)}`,
          },
        ),
      );

      return f.editor.schema
        .node(group)
        .create({ id, key: `section-${section}` }, { indent: 8 }, children);
    });

    f.editor.transact((draft) => {
      draft.step({ kind: 'replaceChildren', parent: 3, index: 0, count: 2, nodes: sections });

      return true;
    });
    await expect.poll(() => f.diagnostics.read()?.pending ?? 0).toBeGreaterThan(0);
    const moved = sections[7];
    const firstId = moved.id + 1;
    const lastId = moved.id + 256;
    f.editor.select(textSelection(firstId, 0));
    f.editor.transact((draft) => {
      draft.step({
        kind: 'moveChildren',
        parent: 3,
        index: 7,
        count: 1,
        toParent: null,
        toIndex: 2,
      });
      draft.step({
        kind: 'replaceText',
        id: firstId,
        from: 0,
        to: 0,
        text: 'Edited while reflowing. ',
      });

      return true;
    });
    await f.view.reveal({ id: firstId, offset: 0 }, { align: 'start' });
    await expect.poll(() => f.view.blockBounds(firstId)?.left).toBe(52);
    const beforeResize = f.view.coordsAt({ id: firstId, offset: 0 });

    if (!beforeResize) throw new Error('Missing moved caret');
    f.element.style.width = '340px';
    await expect.poll(() => f.diagnostics.read()?.width).toBe(284);
    await expect.poll(() => f.diagnostics.read()?.pending ?? 0).toBeGreaterThan(0);
    await expect.poll(() => f.diagnostics.read()?.pending, { timeout: 15_000 }).toBe(0);
    await expect
      .poll(() => f.view.coordsAt({ id: firstId, offset: 0 })?.top)
      .toBeCloseTo(beforeResize.top, 0);
    const first = f.view.blockBounds(firstId);
    const last = f.view.blockBounds(lastId);
    const bounds = f.view.blockBounds(moved.id);

    if (!first || !last || !bounds) throw new Error('Missing reflowed subtree');
    expect(first.top).toBe(bounds.top + 30);
    expect(last.top + last.height).toBe(bounds.top + bounds.height - 14);
    expect(first.width).toBe(248);
    expect(bounds.height).toBeGreaterThan(10_000);
    const wrapper = f.element.querySelector<HTMLElement>(`[data-group="${moved.id}"]`);
    const body = wrapper?.querySelector<HTMLElement>('[data-slot-body]');

    if (!wrapper || !body) throw new Error('Missing resident slot');
    expect(body.getBoundingClientRect().height).toBeCloseTo(bounds.height - 44);
    expect(f.view.blockBounds(firstId, 'client')?.top).toBeCloseTo(
      body.getBoundingClientRect().top,
    );
    expect(f.diagnostics.read()?.residentParagraphs ?? 0).toBeLessThan(256);
    expect(f.diagnostics.read()?.mounted.length ?? 0).toBeLessThan(16);
    expect(f.element.querySelectorAll('canvas')).toHaveLength(1);
    f.editor.transact((draft) => {
      draft.step({ kind: 'removeChildren', parent: null, index: 2, count: 1 });

      return true;
    });
    await expect.poll(() => wrapper.isConnected).toBe(false);
    expect(f.view.blockBounds(moved.id)).toBeNull();
    expect(f.view.coordsAt({ id: firstId, offset: 0 })).toBeNull();
  },
);

test('flow decorations include populated and empty slots, reflow with zoom and resize, activate and cull', async ({
  onTestFinished,
}) => {
  const f = fixture(true, true);
  onTestFinished(() => f.destroy());
  await f.view.ready;
  await expect.poll(() => f.view.blockBounds(2)?.left).toBe(68);
  await f.view.reveal({ id: 5, offset: 136 });
  await expect.poll(() => f.element.querySelector('[data-flow-outline="6"]')).not.toBeNull();

  function check(id: number) {
    const outline = f.element.querySelector<HTMLElement>(`[data-flow-outline="${id}"]`);
    const bounds = f.view.blockBounds(id, 'client');

    if (!outline || !bounds) throw new Error('Missing flow decoration');
    const rect = outline.getBoundingClientRect();
    expect(rect.left).toBeCloseTo(bounds.left);
    expect(rect.top).toBeCloseTo(bounds.top);
    expect(rect.width).toBeCloseTo(bounds.width);
    expect(rect.height).toBeCloseTo(bounds.height);

    const edge = f.element.querySelector<HTMLElement>(
      `[data-editor-focus-node="${id}"][data-edge-widget]`,
    );

    if (!edge) throw new Error('Missing flow edge widget');
    expect(edge.getBoundingClientRect().top).toBeCloseTo(bounds.top + bounds.height);
    expect(edge.getBoundingClientRect().width).toBeCloseTo(bounds.width);
  }

  check(1);
  check(6);
  const chrome = f.element.querySelector<HTMLElement>('[data-group="1"]');

  if (!chrome) throw new Error('Missing flow chrome');
  chrome.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  expect(f.activated).toEqual([1]);
  f.element.style.width = '380px';
  f.view.update({ zoom: 1.25 });
  await expect.poll(() => f.view.blockBounds(1)?.width).toBe(248);
  await f.view.reveal({ id: 5, offset: 136 });
  check(1);
  check(6);
  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceText', id: 7, from: 0, to: 5, text: 'Far below. '.repeat(1000) });

    return true;
  });
  await f.view.reveal({ id: 7, offset: 9999 }, { align: 'start' });
  await expect.poll(() => f.element.querySelectorAll('[data-flow-outline]').length).toBe(0);
});

test('narrow nested slots allocate descendants to the measured DOM width', async ({
  onTestFinished,
}) => {
  const f = fixture(true);
  onTestFinished(() => f.destroy());
  await f.view.ready;
  await expect.poll(() => f.view.blockBounds(4)?.width).toBe(268);
  f.element.style.width = '222px';
  await expect.poll(() => f.view.blockBounds(4)?.width).toBe(70);
  const nested = f.element.querySelector<HTMLElement>('[data-group="3"] [data-slot-body]');
  const cardElement = f.element.querySelector<HTMLElement>('[data-card]');

  if (!nested || !cardElement) throw new Error('Missing nested slot');
  expect(nested.getBoundingClientRect().width).toBe(86);
  expect(cardElement.getBoundingClientRect().width).toBe(70);
  expect(f.view.blockBounds(4)?.height).toBe(35);
  expect(f.view.blockBounds(5)?.width).toBe(70);
  await f.view.reveal({ id: 5, offset: 0 });
  const caret = f.view.coordsAt({ id: 5, offset: 0 });

  if (!caret) throw new Error('Missing narrow text');
  expect(caret.left).toBeCloseTo(nested.getBoundingClientRect().left + 16);
  const chrome = nested.parentElement;

  if (!chrome) throw new Error('Missing wrapper');
  chrome.style.paddingLeft = '57px';
  chrome.style.paddingRight = '57px';
  await expect.poll(() => f.view.blockBounds(5)?.width).toBe(0);
  expect(nested.getBoundingClientRect().width).toBe(0);
  expect(f.view.status).toBe('ready');
  expect(f.view.coordsAt({ id: 5, offset: 0 })).not.toBeNull();
  f.element.style.width = '420px';
  await expect.poll(() => f.view.blockBounds(5)?.width).toBe(182);
  expect(f.view.status).toBe('ready');
  await f.view.reveal({ id: 5, offset: 0 });
  expect(f.view.coordsAt({ id: 5, offset: 0 })?.left).toBeCloseTo(
    nested.getBoundingClientRect().left + 16,
  );
});
