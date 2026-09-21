import { expect, expectTypeOf, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../core';
import { defineNodePresentation, mountEditor, presentations } from '../../editor-canvas';
import { createSchema, defineNode } from '../../model';
import { textSelection } from '../../state';
import {
  decorations,
  defineWidgetView,
  type Decoration,
  type DecorationActivation,
  type DecorationContribution,
  type InvalidateDecorations,
} from '../index';

test('widget keys preserve controls through data changes, wrapped caret placement and reflow', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  let updates = 0;
  let created = 0;
  let destroyed = 0;
  let clicks = 0;

  const widget = defineWidgetView<{ label: string }>((host) => {
    created++;
    const button = document.createElement('button');
    button.style.pointerEvents = 'auto';
    button.dataset.widget = 'review';
    button.addEventListener('click', () => {
      clicks++;
    });
    host.append(button);

    return {
      update({ data, node, at, anchor, selection: scope }) {
        expectTypeOf(data.label).toEqualTypeOf<string>();
        expect(node.id).toBe(1);
        expect(anchor.height).toBeGreaterThan(0);
        expect(at.kind).toBe('text');
        updates++;
        button.dataset.selection = scope.kind;
        button.textContent = data.label;
      },
      destroy() {
        destroyed++;
      },
    };
  });

  function show(offset: number, label: string, upstream = false) {
    f.values.set(1, [
      widget({ key: 'review', at: { kind: 'text', offset, upstream }, data: { label } }),
    ]);
    f.invalidate([1]);
  }

  show(0, 'First');
  await f.view.ready;
  const button = f.element.querySelector<HTMLButtonElement>('[data-widget]');

  if (!button) throw new Error('Widget did not mount');
  const host = button.parentElement;

  if (!host) throw new Error('Missing widget host');
  const selection = f.editor.state.selection;
  await userEvent.click(button);
  expect(clicks).toBe(1);
  expect(f.editor.state.selection).toBe(selection);
  const before = updates;
  f.editor.select(textSelection(2, 3));
  await frame();
  await frame();
  expect(updates).toBe(before + 1);
  expect(button.dataset.selection).toBe('none');
  f.editor.select(textSelection(2, 5));
  await frame();
  await frame();
  expect(updates).toBe(before + 1);
  show(80, 'Moved');
  await expect.poll(() => button.textContent).toBe('Moved');
  expect(created).toBe(1);
  expect(f.element.querySelector('[data-widget]')).toBe(button);

  const checkPosition = (offset: number) => {
    const caret = f.view.coordsAt({ id: 1, offset });

    if (!caret) throw new Error('Missing caret geometry');
    const rect = host.getBoundingClientRect();
    expect(rect.left).toBeCloseTo(caret.left, 1);
    expect(rect.top).toBeCloseTo(caret.top, 1);
  };

  checkPosition(80);
  let wrap = 0;

  for (let offset = 1; offset < 80; offset++) {
    const preceding = f.view.coordsAt({ id: 1, offset: offset - 1 });
    const following = f.view.coordsAt({ id: 1, offset });

    if (preceding && following && preceding.top !== following.top) {
      wrap = offset;
      break;
    }
  }

  expect(wrap).toBeGreaterThan(0);
  show(wrap, 'Upstream', true);
  await expect.poll(() => button.textContent).toBe('Upstream');
  const preceding = f.view.coordsAt({ id: 1, offset: wrap - 1 });
  expect(host.getBoundingClientRect().top).toBeCloseTo(preceding?.top ?? -1, 1);
  expect(host.getBoundingClientRect().left).toBeGreaterThan(preceding?.left ?? -1);
  show(wrap, 'Downstream');
  await expect.poll(() => button.textContent).toBe('Downstream');
  checkPosition(wrap);
  const oldTop = host.getBoundingClientRect().top;
  f.element.style.width = '600px';
  await expect.poll(() => host.getBoundingClientRect().top).not.toBe(oldTop);
  checkPosition(wrap);
  f.values.delete(1);
  f.invalidate([1]);
  await expect.poll(() => button.isConnected).toBe(false);
  expect(destroyed).toBe(1);
});

test('widgets preserve external state across culling and release other instances after a destructor throws', async ({
  onTestFinished,
}) => {
  const f = fixture('node', 100);
  onTestFinished(() => f.destroy());
  let created = 0;
  let destroyed = 0;
  let fail = false;

  const widget = defineWidgetView<string>((host) => {
    created++;
    const button = document.createElement('button');
    button.style.pointerEvents = 'auto';
    host.append(button);

    return {
      update({ data }) {
        button.textContent = data;
      },
      destroy() {
        destroyed++;

        if (fail && button.textContent === 'One') throw new Error('Widget cleanup failed');
      },
    };
  });

  f.values.set(
    1,
    ['One', 'Two'].map((data) => widget({ key: data, at: { kind: 'node', edge: 'end' }, data })),
  );
  await f.view.ready;
  expect(created).toBe(2);
  f.editor.select(textSelection(100, 0));
  await f.view.reveal({ id: 100, offset: 0 });
  await expect.poll(() => destroyed).toBe(2);
  f.editor.select(textSelection(1, 0));
  await f.view.reveal({ id: 1, offset: 0 });
  await expect.poll(() => created).toBe(4);
  expect(f.element.textContent).toContain('OneTwo');
  fail = true;
  f.values.delete(1);
  f.invalidate([1]);
  await expect.poll(() => f.view.status).toBe('failed');
  expect(destroyed).toBe(4);
  expect(f.listeners.size).toBe(0);
  expect(f.destroyed).toBe(1);
  expect(f.element.children.length).toBe(0);
});

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text' },
  }),
});

const presentation = defineExtension({
  name: 'presentation',
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

    return {};
  },
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function fixture(dependencies: DecorationContribution['dependencies'] = 'node', count = 3) {
  const values = new Map<number, readonly Decoration[]>();
  const listeners = new Set<InvalidateDecorations>();
  const reads = new Map<number, number>();
  const activations: DecorationActivation[] = [];
  let destroyed = 0;

  const source = defineExtension({
    name: 'annotations',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(decorations, {
        name: 'annotations',
        dependencies,
        create(editor) {
          return {
            read(id, state) {
              expect(state).toBe(editor.state);
              reads.set(id, (reads.get(id) ?? 0) + 1);

              return values.get(id) ?? [];
            },
            subscribe(listener) {
              listeners.add(listener);

              return () => {
                listeners.delete(listener);
              };
            },
            destroy() {
              destroyed++;
            },
          };
        },
      });

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [note, presentation, source] }),
    content: Array.from({ length: count }, (_, index) => ({
      kind: 'note' as const,
      id: index + 1,
      text:
        index === 0
          ? 'Wrapped highlighted text. '.repeat(12)
          : `Paragraph ${index}. More text here.`,
    })),
  });

  const element = document.createElement('div');
  element.style.cssText = 'width:340px;height:660px;';
  document.body.append(element);
  const failures: Error[] = [];
  const view = mountEditor(element, { editor, onError: (error) => failures.push(error) });

  return {
    editor,
    element,
    view,
    values,
    reads,
    listeners,
    failures,
    activations,
    get destroyed() {
      return destroyed;
    },
    highlight(id: number, from = 0, to = 80) {
      values.set(id, [
        {
          kind: 'text',
          key: `range:${id}`,
          from,
          to,
          background: '#198754',
          activation: {
            label: 'Inspect range',
            attributes: { 'data-range-id': String(id) },
            onActivate: (event) => activations.push(event),
          },
        },
      ]);
    },
    invalidate(ids?: readonly number[]) {
      for (const listener of listeners) listener(ids);
    },
    destroy() {
      view.destroy();
      editor.destroy();
      element.remove();
    },
  };
}

test('public sources project wrapped ranges with stable controls and targeted external invalidation', async ({
  onTestFinished,
}) => {
  const f = fixture();
  f.highlight(1);
  f.highlight(2, 0, 8);
  onTestFinished(() => f.destroy());
  await f.view.ready;
  const controls = f.element.querySelectorAll<HTMLButtonElement>('[data-range-id="1"]');
  expect(controls.length).toBeGreaterThan(2);
  const first = controls[0];
  first.click();
  expect(f.activations.at(-1)).toMatchObject({
    nodeId: 1,
    key: 'range:1',
    kind: 'control',
    offset: 0,
  });
  const before = new Map(f.reads);
  const state = f.editor.state;
  f.highlight(2, 2, 12);
  f.invalidate([2]);
  await expect.poll(() => f.reads.get(2)).toBe((before.get(2) ?? 0) + 1);
  expect(f.reads.get(1)).toBe(before.get(1));
  expect(f.reads.get(3)).toBe(before.get(3));
  expect(f.editor.state).toBe(state);
  f.highlight(1, 3, 85);
  f.invalidate([1]);
  await expect.poll(() => f.reads.get(1)).toBe((before.get(1) ?? 0) + 1);
  expect(f.element.querySelector('[data-range-id="1"]')).toBe(first);
  first.click();
  expect(f.activations.at(-1)?.offset).toBe(3);
  f.values.delete(1);
  f.invalidate([1]);
  await expect.poll(() => f.element.querySelector('[data-range-id="1"]')).toBeNull();
});

test('dependency declarations distinguish node-local reads from document-wide reads', async ({
  onTestFinished,
}) => {
  const local = fixture('node');
  const global = fixture('document');
  onTestFinished(() => {
    local.destroy();
    global.destroy();
  });
  await local.view.ready;
  await global.view.ready;

  await Promise.all(
    [local, global].map(async (f) => {
      const previous = new Map(f.reads);
      f.editor.transact((draft) => {
        draft.step({ kind: 'replaceText', id: 2, from: 0, to: 0, text: 'Changed ' });

        return true;
      });
      await expect.poll(() => f.reads.get(2)).toBe((previous.get(2) ?? 0) + 1);
      expect(f.reads.get(1)).toBe((previous.get(1) ?? 0) + (f === global ? 1 : 0));
      expect(f.reads.get(3)).toBe((previous.get(3) ?? 0) + (f === global ? 1 : 0));
    }),
  );
});

test('offscreen invalidation waits for residency, eviction drops cached results, and cleanup releases the source', async ({
  onTestFinished,
}) => {
  const f = fixture('node', 100);
  onTestFinished(() => f.destroy());
  f.highlight(1);
  await f.view.ready;
  expect(f.reads.has(100)).toBe(false);
  const before = f.reads.get(1);
  f.highlight(100, 0, 6);
  f.invalidate([100]);
  await frame();
  await frame();
  expect(f.reads.has(100)).toBe(false);
  expect(f.reads.get(1)).toBe(before);
  f.editor.select(textSelection(100, 0));
  await f.view.reveal({ id: 100, offset: 0 });
  await expect.poll(() => f.element.querySelector('[data-range-id="100"]')).not.toBeNull();
  expect(f.element.querySelector('[data-range-id="1"]')).toBeNull();
  f.editor.select(textSelection(1, 0));
  await f.view.reveal({ id: 1, offset: 0 });
  await expect.poll(() => f.element.querySelector('[data-range-id="1"]')).not.toBeNull();
  expect(f.reads.get(1)).toBe((before ?? 0) + 1);
  f.view.destroy();
  expect(f.listeners.size).toBe(0);
  expect(f.destroyed).toBe(1);
  f.invalidate();
  await frame();
  expect(f.element.children.length).toBe(0);
});

test('node outlines activate over canvas text and duplicate source keys fail with complete cleanup', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());

  const outline: Decoration = {
    kind: 'node',
    key: 'whole-node',
    outline: { color: '#198754', width: 2, radius: 4 },
    attributes: { 'data-outline': '1' },
    activation: { onActivate: (event) => f.activations.push(event) },
  };

  f.values.set(1, [outline]);
  await f.view.ready;
  const element = f.element.querySelector<HTMLElement>('[data-outline="1"]');
  expect(element).not.toBeNull();
  const caret = f.view.coordsAt({ id: 1, offset: 5 });
  const surface = f.element.querySelector('[data-editor-view]');

  if (!caret || !surface) throw new Error('Missing canvas geometry');
  surface.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
      clientX: caret.left + 0.1,
      clientY: caret.top + caret.height / 2,
    }),
  );
  surface.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  expect(f.activations.at(-1)).toMatchObject({ key: 'whole-node', nodeId: 1, kind: 'control' });
  f.values.set(1, [outline, outline]);
  f.invalidate([1]);
  await expect.poll(() => f.view.status).toBe('failed');
  expect(f.failures[0].message).toMatch(/Duplicate or empty decoration key/);
  expect(f.listeners.size).toBe(0);
  expect(f.destroyed).toBe(1);
  expect(f.element.children.length).toBe(0);
});

test.for(['duplicate', 'empty', 'subscription'])(
  'invalid decoration %s setup fails the mount and releases allocated sources',
  async (failure, { onTestFinished }) => {
    let created = 0;
    let destroyed = 0;

    const provider: DecorationContribution = {
      name: failure === 'empty' ? '' : 'annotations',
      create() {
        created++;

        return {
          read: () => [],
          subscribe() {
            throw new Error('Cannot subscribe to annotations');
          },
          destroy() {
            destroyed++;
          },
        };
      },
    };

    const extension = defineExtension({
      name: 'invalidDecorations',
      options: {},
      setup(_options, context: ContributionContext) {
        context.provide(decorations, provider);

        if (failure === 'duplicate') context.provide(decorations, provider);

        return {};
      },
    });

    const editor = createEditor({
      schema: createSchema({ extensions: [note, presentation, extension] }),
      content: [{ kind: 'note', id: 1, text: 'Content survives a failed view.' }],
    });

    const element = document.createElement('div');
    element.style.cssText = 'width:340px;height:400px;';
    document.body.append(element);
    const view = mountEditor(element, { editor });
    onTestFinished(() => {
      view.destroy();
      editor.destroy();
      element.remove();
    });
    await expect(view.ready).rejects.toThrow(
      failure === 'subscription' ? /Cannot subscribe/ : /Duplicate or empty decoration source/,
    );
    expect(view.status).toBe('failed');
    expect(created).toBe(failure === 'subscription' ? 1 : 0);
    expect(destroyed).toBe(created);
    expect(element.children.length).toBe(0);
    expect(editor.isDestroyed).toBe(false);
  },
);
