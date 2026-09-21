import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../core';
import { createSchema, defineNode } from '../../model';
import { selectionContext } from '../../state';
import { createNodeViews, defineNodeView, nodeViews } from '../node-views';

const card = defineNode({
  name: 'card',
  version: 1,
  options: { defaultLabel: 'Card' },
  schema: (options) => ({
    attributes: z.strictObject({ label: z.string().default(options.defaultLabel) }),
    content: { kind: 'atom' },
  }),
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
