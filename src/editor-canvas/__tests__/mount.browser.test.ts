import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../core';
import { inputPolicies } from '../../editor-browser/input-contributions';
import { defineNodeView, nodeViews } from '../../editor-browser/node-views';
import { createSchema, defineNode } from '../../model';
import { TextSelection, textSelection } from '../../state';
import { mountEditor, defineNodePresentation, presentations } from '../index';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ body: z.string() }),
    content: { kind: 'text', field: 'body' },
  }),
});

const card = defineNode({
  name: 'card',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({ label: z.string() }), content: { kind: 'atom' } }),
});

const views = defineExtension({
  name: 'views',
  options: {},
  requires: [note.name, card.name],
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(note, () => (attrs) => {
        if (attrs.body === 'FAIL') throw new Error('Presentation failed');

        return {
          kind: 'text',
          text: attrs.body,
          size: 18,
          lineHeight: 28,
          before: 0,
          after: 16,
          baselineGrid: 4,
          spans: [],
          atoms: [],
        };
      }),
    );
    context.provide(
      presentations,
      defineNodePresentation(card, () => () => ({
        kind: 'box',
        height: 60,
        before: 0,
        after: 16,
        baselineGrid: 4,
      })),
    );
    context.provide(
      nodeViews,
      defineNodeView(card, () => (element) => {
        const button = document.createElement('button');
        element.append(button);

        return {
          update({ attributes, node, width, onMeasure }) {
            button.textContent = attributes.label;
            onMeasure(node.id, width, 60);
          },
          destroy: () => element.replaceChildren(),
        };
      }),
    );
    context.provide(inputPolicies, {
      create({ editor, textInput, input }) {
        return {
          input() {
            textInput.read(input, (from, to, text) => {
              const selection = editor.state.selection;

              if (!(selection instanceof TextSelection)) return;
              const id = selection.head.id;

              const applied = editor.transact((draft) => {
                draft.step({ kind: 'replaceText', id, from, to, text });
                draft.select(textSelection(id, from + text.length));

                return true;
              });

              if (!applied) textInput.sync(input);
            });
          },
        };
      },
    });

    return {};
  },
});

const schema = createSchema({ extensions: [note, card, views] });

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function fixture() {
  const editor = createEditor({
    schema,
    selection: textSelection(1, 0),
    content: [
      { kind: 'note', id: 1, body: 'First line of a custom schema.' },
      { kind: 'note', id: 2, body: 'Second paragraph with selectable text.' },
      { kind: 'card', id: 3, label: 'Interactive card' },
    ],
  });

  const element = document.createElement('div');
  element.style.cssText = 'width:420px;height:260px;';
  document.body.append(element);

  return {
    editor,
    element,
    destroy() {
      editor.destroy();
      element.remove();
    },
  };
}

function capture(element: HTMLElement) {
  const value = element.querySelector('textarea');

  if (!value) throw new Error('Missing editor capture');

  return value;
}

test('vanilla mount loads its own assets, edits a foreign schema and resolves client caret geometry', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const view = mountEditor(f.element, { editor: f.editor });
  expect(view.status).toBe('loading');
  f.editor.commands.focus();
  await view.ready;
  expect(view.status).toBe('ready');
  const input = capture(f.element);
  expect(document.activeElement).toBe(input);
  const before = view.coordsAt({ id: 1, offset: 0 });
  expect(before?.height).toBeGreaterThan(0);
  input.setRangeText('Hello ', 0, 0, 'end');
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Hello ' }),
  );
  await frame();
  expect(f.editor.state.nodes[0]).toMatchObject({ body: 'Hello First line of a custom schema.' });
  expect(view.coordsAt({ id: 1, offset: 6 })?.x).toBeGreaterThan(before?.x ?? 0);
  const end = view.coordsAt({ id: 2, offset: 6 });

  if (!end) throw new Error('Expected second paragraph geometry');
  const root = f.element.querySelector('[data-editor-view]');

  if (!root) throw new Error('Missing mounted root');
  const bounds = root.getBoundingClientRect();
  await userEvent.click(root, {
    position: { x: end.x - bounds.left, y: end.y - bounds.top + 3 },
    modifiers: ['Shift'],
  });
  expect(f.editor.state.selection).toMatchObject({ anchor: { id: 1 }, head: { id: 2 } });
  view.destroy();
  expect(f.editor.isDestroyed).toBe(false);
  expect(f.element.childElementCount).toBe(0);
  expect(view.coordsAt({ id: 1, offset: 0 })).toBeNull();
  const replacement = mountEditor(f.element, { editor: f.editor });
  await replacement.ready;
  view.destroy();
  expect(replacement.status).toBe('ready');
  expect(f.element.querySelector('canvas')).not.toBeNull();
});

test('interactive node views preserve native focus and two editors own independent graphics', async ({
  onTestFinished,
}) => {
  const first = fixture();
  const second = fixture();
  onTestFinished(() => {
    first.destroy();
    second.destroy();
  });
  const a = mountEditor(first.element, { editor: first.editor });
  const b = mountEditor(second.element, { editor: second.editor });
  await Promise.all([a.ready, b.ready]);
  const button = second.element.querySelector('button');

  if (!button) throw new Error('Missing contributed node view');
  button.focus();
  const original = second.editor.state.selection;
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, button: 0 }));
  expect(document.activeElement).toBe(button);
  expect(second.editor.state.selection).toBe(original);
  first.editor.destroy();
  expect(a.status).toBe('destroyed');
  second.editor.select(textSelection(2, 4));
  second.editor.commands.focus();
  await frame();
  expect(b.coordsAt({ id: 2, offset: 4 })?.height).toBeGreaterThan(0);
  expect(document.activeElement).toBe(capture(second.element));
});

test('destruction during initialization cancels readiness, releases the attachment and cannot paint late', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const view = mountEditor(f.element, { editor: f.editor });
  expect(() => mountEditor(f.element, { editor: f.editor })).toThrow(/one mounted view/);
  view.destroy();
  await expect(view.ready).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.element.childElementCount).toBe(0);
  const next = mountEditor(f.element, { editor: f.editor });
  await next.ready;
  await frame();
  expect(f.element.querySelectorAll('canvas')).toHaveLength(1);
  expect(next.status).toBe('ready');
});

test('asset failure cleans up the view and permits retry on the same live session', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());

  const view = mountEditor(f.element, {
    editor: f.editor,
    resolveAsset: () => 'data:application/wasm,invalid',
  });

  await expect(view.ready).rejects.toThrow(/Invalid graphics/);
  expect(view.status).toBe('failed');
  expect(f.element.childElementCount).toBe(0);
  expect(f.editor.isDestroyed).toBe(false);
  const next = mountEditor(f.element, { editor: f.editor });
  await next.ready;
  view.destroy();
  expect(next.status).toBe('ready');
});

test('background presentation failure reports an error and releases the native mount', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const errors: Error[] = [];
  const view = mountEditor(f.element, { editor: f.editor, onError: (error) => errors.push(error) });
  await view.ready;
  f.editor.transact((draft) => {
    draft.step({
      kind: 'replaceText',
      id: 1,
      from: 0,
      to: 'First line of a custom schema.'.length,
      text: 'FAIL',
    });

    return true;
  });
  await expect.poll(() => view.status).toBe('failed');
  expect(errors).toHaveLength(1);
  expect(view.error).toBe(errors[0]);
  expect(view.error?.message).toBe('Presentation failed');
  expect(f.element.childElementCount).toBe(0);
  expect(f.editor.isDestroyed).toBe(false);
});

test('page scrolling reveals distant selections and preserves the client coordinate mapping', async ({
  onTestFinished,
}) => {
  const f = fixture();
  f.element.style.height = 'auto';
  f.element.style.marginTop = '80px';
  onTestFinished(() => {
    f.destroy();
    window.scrollTo(0, 0);
  });
  f.editor.transact((draft) => {
    draft.step({
      kind: 'replaceChildren',
      parent: null,
      index: 3,
      count: 0,
      nodes: Array.from({ length: 80 }, (_, index) =>
        schema
          .node(note)
          .create({ id: index + 4, key: `appended-${index}` }, { body: `Paragraph ${index}` }),
      ),
    });

    return true;
  });
  const view = mountEditor(f.element, { editor: f.editor, scroll: 'page' });
  await view.ready;
  f.editor.select(textSelection(80, 3));
  f.editor.commands.scrollIntoView();
  await expect.poll(() => window.scrollY).toBeGreaterThan(500);
  const point = view.coordsAt({ id: 80, offset: 3 });
  expect(point?.top).toBeGreaterThanOrEqual(0);
  expect(point?.bottom).toBeLessThanOrEqual(window.innerHeight);
});

test('public reveal retains selection, follows intervening edits, and cancels superseded or destroyed requests', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  f.editor.transact((draft) => {
    draft.step({
      kind: 'replaceChildren',
      parent: null,
      index: 3,
      count: 0,
      nodes: Array.from({ length: 80 }, (_, index) =>
        schema
          .node(note)
          .create({ id: index + 4, key: `reveal-${index}` }, { body: `Paragraph ${index}` }),
      ),
    });

    return true;
  });
  const view = mountEditor(f.element, { editor: f.editor });
  await view.ready;
  const selection = f.editor.state.selection;
  const focus = document.activeElement;
  const first = view.reveal({ id: 70, offset: 3 });
  const second = view.reveal({ id: 80, offset: 3 });
  const prefix = 'Inserted line\n'.repeat(30);
  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceText', id: 80, from: 0, to: 0, text: prefix });

    return true;
  });
  expect(view.coordsAt({ id: 80, offset: 3 })).toBeNull();
  expect(await first).toBe(false);
  expect(await second).toBe(true);
  const caret = view.coordsAt({ id: 80, offset: prefix.length + 3 });
  const bounds = f.element.getBoundingClientRect();
  expect(caret?.top).toBeGreaterThanOrEqual(bounds.top - 1);
  expect(caret?.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
  expect(view.coordsAt({ id: 80, offset: 3 })?.top).toBeLessThan(bounds.top);
  expect(f.editor.state.selection.eq(selection)).toBe(true);
  expect(document.activeElement).toBe(focus);
  const cancelled = view.reveal({ id: 1, offset: 2 });
  view.destroy();
  expect(await cancelled).toBe(false);
  expect(await view.reveal({ id: 1, offset: 2 })).toBe(false);
  expect(view.coordsAt({ id: 80, offset: prefix.length + 3 })).toBeNull();
});

test('reveal follows the durable deletion fallback and cancels when its loading view is destroyed', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const view = mountEditor(f.element, { editor: f.editor });
  await view.ready;
  const anchor = f.editor.positions.at(2, 3);
  const request = view.reveal({ id: 2, offset: 3 });
  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceChildren', parent: null, index: 1, count: 1, nodes: [] });

    return true;
  });
  const result = f.editor.positions.resolve(anchor);

  if (result.status !== 'resolved') throw new Error('Missing deletion fallback');
  expect(result.point.id).toBe(1);
  expect(await request).toBe(true);
  expect(view.coordsAt(result.point)?.height).toBeGreaterThan(0);
  view.destroy();
  const loading = mountEditor(f.element, { editor: f.editor });
  const cancelled = loading.reveal({ id: 1, offset: 2 });
  loading.destroy();
  expect(await cancelled).toBe(false);
  await expect(loading.ready).rejects.toMatchObject({ name: 'AbortError' });
});

test('a throwing node-view destructor cannot prevent other views and the mount from being released', async ({
  onTestFinished,
}) => {
  const released: string[] = [];

  const throwingViews = defineExtension({
    name: 'throwingViews',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(
        presentations,
        defineNodePresentation(card, () => () => ({
          kind: 'box',
          height: 60,
          before: 0,
          after: 16,
          baselineGrid: 4,
        })),
      );
      context.provide(
        nodeViews,
        defineNodeView(card, () => (element) => ({
          update({ attributes }) {
            element.textContent = attributes.label;
          },
          destroy() {
            const label = element.textContent ?? '';
            released.push(label);

            if (label === 'First') throw new Error('Extension cleanup failed');
            element.replaceChildren();
          },
        })),
      );

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [card, throwingViews] }),
    content: [
      { kind: 'card', label: 'First' },
      { kind: 'card', label: 'Second' },
    ],
  });

  const host = document.createElement('div');
  host.style.cssText = 'width:400px;height:300px;';
  document.body.append(host);
  const view = mountEditor(host, { editor });
  onTestFinished(() => {
    view.destroy();
    editor.destroy();
    host.remove();
  });
  await view.ready;
  expect(() => view.destroy()).toThrow('Editor view cleanup failed');
  expect(released).toEqual(['First', 'Second']);
  expect(host.childElementCount).toBe(0);
  expect(editor.isDestroyed).toBe(false);
  expect(view.isDestroyed).toBe(true);
  editor.destroy();
  expect(released).toHaveLength(2);
});
