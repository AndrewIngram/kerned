import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../core';
import {
  decorations,
  defineWidgetView,
  defineNodeView,
  nodeViews,
  type Decoration,
} from '../../editor-browser';
import { createSchema, defineNode } from '../../model';
import { textSelection } from '../../state';
import { defineNodePresentation, mountEditor, presentations } from '../index';

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

const schema = createSchema({ extensions: [note, group, card, rendering] });

function fixture() {
  const editor = createEditor({
    schema,
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
  const view = mountEditor(element, { editor });

  return {
    editor,
    element,
    view,
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
  expect(f.view.blockBounds(6)).toBeNull();
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
