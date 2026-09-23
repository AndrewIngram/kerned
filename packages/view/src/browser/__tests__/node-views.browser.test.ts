import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { createSchema, defineNode } from '@kerned/model';
import { selectionContext } from '@kerned/state';
import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { decorations, type TextDecoration } from '../decorations.js';
import { createNodeViews, defineNodeView, nodeViews } from '../node-views.js';

const card = defineNode({
  name: 'card',
  version: 1,
  options: { defaultLabel: 'Card' },
  schema: (options) => ({
    attributes: z.strictObject({ label: z.string().default(options.defaultLabel) }),
    content: { kind: 'atom' },
  }),
});

test('native decorations compose, coalesce updates and release every subscription on failure', async ({
  onTestFinished,
}) => {
  const listeners = new Set<() => void>();

  let values: readonly TextDecoration[] = [
    { kind: 'text', key: 'one', from: 0, to: 1, background: 'gold' },
  ];

  const extra: readonly TextDecoration[] = [
    { kind: 'text', key: 'two', from: 1, to: 2, background: 'pink' },
  ];

  const seen: (readonly TextDecoration[])[] = [];
  let failUpdate = false;
  let failCleanup = false;
  let destroyed = 0;
  const errors: Error[] = [];

  const extension = defineExtension({
    name: 'decoratedCard',
    options: {},
    setup(_options, context: ContributionContext) {
      for (const [index, read] of [() => values, () => extra].entries()) {
        context.provide(decorations, {
          name: `source:${index}`,
          create: () => ({
            read,
            subscribe(listener) {
              listeners.add(listener);

              return () => {
                listeners.delete(listener);

                if (failCleanup) throw new Error('Source cleanup failed');
              };
            },
          }),
        });
      }

      context.provide(
        nodeViews,
        defineNodeView(card, () => (element) => ({
          update({ node, textDecorations }) {
            if (failUpdate) throw new Error('Update failed');
            const ranges = textDecorations?.(node.id) ?? [];
            seen.push(ranges);
            element.textContent = ranges.map((value) => value.key).join(',');
          },
          destroy() {
            destroyed++;
            element.replaceChildren();
          },
        })),
      );

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [card, extension] }),
    content: [{ kind: 'card' }],
  });

  const node = editor.state.nodes[0];

  const renderer = createNodeViews(editor, {
    clipboard() {},
    notice() {},
    onError: (error) => errors.push(error),
  }).find(node);

  if (!renderer) throw new Error('Missing renderer');
  const element = host();
  const view = renderer.mount(element);
  onTestFinished(() => {
    view.destroy();
    editor.destroy();
    element.remove();
  });

  const frame = {
    node,
    selection: editor.state.selection,
    context: selectionContext(editor.schema, editor.state.nodes),
    width: 240,
    onMeasure() {},
  };

  view.update(frame);
  const first = seen.at(-1);
  view.update(frame);
  expect(seen.at(-1)).toBe(first);
  expect(element.textContent).toBe('["source:0","one"],["source:1","two"]');
  expect(listeners.size).toBe(2);
  const count = seen.length;
  values = [{ kind: 'text', key: 'changed', from: 0, to: 2, background: 'blue' }];

  for (const listener of listeners) {
    listener();
    listener();
  }

  await expect.poll(() => element.textContent).toBe('["source:0","changed"],["source:1","two"]');
  expect(seen).toHaveLength(count + 1);
  failUpdate = true;

  for (const listener of listeners) listener();
  await expect.poll(() => errors.length).toBe(1);
  expect(errors[0].message).toBe('Update failed');
  failCleanup = true;

  for (const listener of listeners) listener();
  expect(() => view.destroy()).toThrow('Node view cleanup failed');
  expect(listeners.size).toBe(0);
  expect(destroyed).toBe(1);
  expect(element.children).toHaveLength(0);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(errors).toHaveLength(1);
});

function host() {
  const element = document.createElement('div');
  element.style.width = '240px';
  document.body.append(element);

  return element;
}

test('a foreign schema renders through its composed contribution with normalized typed attributes', ({
  onTestFinished,
}) => {
  let setups = 0;
  let factories = 0;
  let removals = 0;

  const viewExtension = defineExtension({
    name: 'cardView',
    requires: ['card'],
    options: { suffix: '!' },
    setup(options, context: ContributionContext) {
      setups++;
      context.provide(
        nodeViews,
        defineNodeView(card, () => {
          factories++;

          return (element) => {
            const button = element.ownerDocument.createElement('button');
            element.append(button);

            return {
              update({ node, attributes, width, onMeasure }) {
                expectTypeOf(attributes.label).toEqualTypeOf<string>();
                button.textContent = attributes.label + options.suffix;
                element.dataset.node = String(node.id);
                onMeasure(node.id, width, element.offsetHeight);
              },
              destroy() {
                removals++;
                element.replaceChildren();
              },
            };
          };
        }),
      );

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({
      extensions: [
        card.configure({ defaultLabel: 'Configured' }),
        viewExtension.configure({ suffix: '?' }),
      ],
    }),
    content: [{ kind: 'card' }],
  });

  const collection = createNodeViews(editor, { clipboard() {}, notice() {} });
  const node = editor.state.nodes[0];
  const renderer = collection.find(node);
  const element = host();
  onTestFinished(() => {
    editor.destroy();
    element.remove();
  });

  if (!renderer) throw new Error('Missing card view');
  const view = renderer.mount(element);
  const heights: number[] = [];
  view.update({
    node,
    selection: editor.state.selection,
    context: selectionContext(editor.schema, editor.state.nodes),
    width: 240,
    onMeasure: (_id, _width, height) => heights.push(height),
  });
  expect(element.textContent).toBe('Configured?');
  expect(element.dataset.node).toBe(String(node.id));
  expect(heights[0]).toBeGreaterThan(0);
  element.querySelector('button')?.focus();
  expect(document.activeElement).toBe(element.querySelector('button'));
  expect(setups).toBe(1);
  expect(factories).toBe(1);
  view.destroy();
  view.destroy();
  expect(removals).toBe(1);
  expect(editor.isDestroyed).toBe(false);
  const replacement = renderer.mount(element);
  replacement.update({
    node,
    selection: editor.state.selection,
    context: selectionContext(editor.schema, editor.state.nodes),
    width: 240,
    onMeasure: () => {},
  });
  view.destroy();
  expect(element.textContent).toBe('Configured?');
  editor.destroy();
  expect(removals).toBe(2);
  expect(element.textContent).toBe('');
  expect(() =>
    replacement.update({
      node,
      selection: editor.state.selection,
      context: selectionContext(editor.schema, editor.state.nodes),
      width: 240,
      onMeasure: () => {},
    }),
  ).toThrow(/destroyed/);
  expect(() => renderer.mount(element)).toThrow(/destroyed/);
});

test('node view composition rejects duplicate and unrelated definitions', () => {
  const view = defineNodeView(card, () => (element) => ({
    update: () => {},
    destroy: () => element.replaceChildren(),
  }));

  const defaults = { duplicate: false };

  const extension = defineExtension({
    name: 'views',
    options: defaults,
    setup(options, context: ContributionContext) {
      context.provide(nodeViews, view);

      if (options.duplicate) context.provide(nodeViews, view);

      return {};
    },
  });

  const duplicate = createEditor({
    schema: createSchema({ extensions: [card, extension.configure({ duplicate: true })] }),
    content: [],
  });

  expect(() => createNodeViews(duplicate, { clipboard() {}, notice() {} })).toThrow(
    /Duplicate node renderer/,
  );
  duplicate.destroy();

  const otherCard = defineNode({
    name: 'card',
    version: 1,
    options: {},
    schema: () => ({
      attributes: z.strictObject({ count: z.number() }),
      content: { kind: 'atom' },
    }),
  });

  const unrelated = createEditor({
    schema: createSchema({ extensions: [otherCard, extension] }),
    content: [],
  });

  expect(() => createNodeViews(unrelated, { clipboard() {}, notice() {} })).toThrow(
    /Different node definition/,
  );
  unrelated.destroy();

  const headless = createEditor({
    schema: createSchema({ extensions: [card] }),
    content: [{ kind: 'card', label: 'No view' }],
  });

  expect(
    createNodeViews(headless, { clipboard() {}, notice() {} }).find(headless.state.nodes[0]),
  ).toBeUndefined();
  headless.destroy();
});

test('node factory resources survive culling and end with the view, including setup failure', ({
  onTestFinished,
}) => {
  let live = 0;
  let fail = false;
  let instances = 0;

  const rendering = defineExtension({
    name: 'resources',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(
        nodeViews,
        defineNodeView(card, ({ onDestroy }) => {
          live++;
          onDestroy(() => {
            live--;
          });

          if (fail) throw new Error('Factory failed');

          return () => {
            instances++;

            return {
              update() {},
              destroy() {
                instances--;
              },
            };
          };
        }),
      );

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [card, rendering] }),
    content: [{ kind: 'card' }],
  });

  onTestFinished(() => editor.destroy());
  const environment = { clipboard() {}, notice() {} };
  const collection = createNodeViews(editor, environment);
  const renderer = collection.find(editor.state.nodes[0]);

  if (!renderer) throw new Error('Missing card renderer');
  const instance = renderer.mount(document.createElement('div'));
  instance.destroy();
  expect(instances).toBe(0);
  expect(live).toBe(1);
  renderer.mount(document.createElement('div'));
  collection.destroy();
  expect(instances).toBe(0);
  expect(live).toBe(0);
  expect(editor.isDestroyed).toBe(false);
  expect(() => renderer.mount(document.createElement('div'))).toThrow(/destroyed/);
  collection.destroy();
  fail = true;
  expect(() => createNodeViews(editor, environment)).toThrow('Factory failed');
  expect(live).toBe(0);
  fail = false;
  const remounted = createNodeViews(editor, environment);
  expect(live).toBe(1);
  editor.destroy();
  expect(live).toBe(0);
  remounted.destroy();
});
