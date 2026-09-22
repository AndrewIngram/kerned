import { createEditor, defineExtension, type ContributionContext } from '@gprose/core';
import { createSchema, defineNode } from '@gprose/model';
import { TextSelection, textSelection } from '@gprose/state';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';

import { inputPolicies } from '../../editor-browser/input-contributions';
import { defineNodeView, nodeViews } from '../../editor-browser/node-views';
import { createViewDiagnostics, type DiagnosticEvent } from '../diagnostics';
import { defaultFonts } from '../font-catalog';
import { mountEditor, defineNodePresentation, defineStyleRule, presentations } from '../index';

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

const factoryCounts = new WeakMap<object, number>();

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
      defineNodeView(card, ({ editor, onDestroy }) => {
        factoryCounts.set(editor, (factoryCounts.get(editor) ?? 0) + 1);
        onDestroy(() => factoryCounts.set(editor, (factoryCounts.get(editor) ?? 0) - 1));

        return (element) => {
          const button = document.createElement('button');
          element.append(button);

          return {
            update({ attributes, node, width, onMeasure }) {
              button.textContent = attributes.label;
              onMeasure(node.id, width, 60);
            },
            destroy: () => element.replaceChildren(),
          };
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

test('live view configuration preserves the attachment and publishes immutable document geometry', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const view = mountEditor(f.element, { editor: f.editor, paddingTop: 12 });
  expect(view.getSnapshot()).toBeNull();
  view.update({ zoom: 1.25, paddingTop: 24 });
  await view.ready;
  await frame();
  const initial = view.getSnapshot();
  const before = view.blockBounds(1);

  if (!initial || !before) throw new Error('Expected published geometry');
  expect(initial.zoom).toBe(1.25);
  expect(initial.documentRevision).toBe(f.editor.state.revision);
  expect(initial.viewport.width).toBeCloseTo(420 / 1.25);
  expect(Object.isFrozen(initial)).toBe(true);
  expect(Object.isFrozen(initial.content)).toBe(true);
  expect(view.blockBounds(999)).toBeNull();
  const canvas = f.element.querySelector('canvas');
  const input = capture(f.element);
  view.focus();
  const selection = f.editor.state.selection;
  view.update({ paddingTop: 64 });
  expect(view.blockBounds(1)?.top).toBeCloseTo(before.top + 40);
  view.update({ zoom: 1.5 });
  expect(view.getSnapshot()?.zoom).toBe(1.5);
  expect(view.getSnapshot()?.viewport.width).toBeCloseTo(420 / 1.5);
  expect(f.element.querySelector('canvas')).toBe(canvas);
  expect(document.activeElement).toBe(input);
  expect(f.editor.state.selection).toBe(selection);
  const current = view.getSnapshot();
  view.update({ zoom: 1.5 });
  expect(view.getSnapshot()).toBe(current);
  expect(() => view.update({ zoom: 2, paddingTop: -1 })).toThrow(/paddingTop/);
  expect(view.status).toBe('ready');
  expect(view.getSnapshot()).toBe(current);
  expect(initial.zoom).toBe(1.25);
  expect(view.coordsAt({ id: 1, offset: 0 })?.height).toBeGreaterThan(0);
  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'More text ' });

    return true;
  });
  expect(view.blockBounds(1)).toBeNull();
  await expect.poll(() => view.getSnapshot()?.documentRevision).toBe(f.editor.state.revision);
  expect(view.blockBounds(1)).not.toBeNull();
  view.destroy();
  expect(view.getSnapshot()).toBeNull();
  expect(view.blockBounds(1)).toBeNull();
  expect(() => view.update({ zoom: 1 })).toThrow(/destroyed/);
  expect(() => view.subscribe(() => {})).toThrow(/destroyed/);
});

test('view observers run after native reconciliation and can update, unsubscribe or destroy safely', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const view = mountEditor(f.element, { editor: f.editor });
  const observed: number[] = [];
  let initialObserved = false;

  const unsubscribe = view.subscribe(() => {
    const snapshot = view.getSnapshot();

    if (!snapshot) return;
    observed.push(snapshot.zoom);
    expect(f.element.querySelector('button')?.textContent).toBe('Interactive card');
    expect(view.coordsAt({ id: 1, offset: 0 })?.height).toBeGreaterThan(0);

    if (initialObserved) return;
    initialObserved = true;
    view.update({ zoom: 1.25 });
  });

  await view.ready;
  await expect.poll(() => observed).toContain(1.25);
  unsubscribe();
  const count = observed.length;
  view.update({ zoom: 1.5 });
  await frame();
  expect(observed).toHaveLength(count);
  let destroyedNotice = false;
  view.subscribe(() => {
    if (view.getSnapshot()) view.destroy();
    else destroyedNotice = true;
  });
  view.update({ paddingTop: 20 });
  await expect.poll(() => view.status).toBe('destroyed');
  await frame();
  expect(destroyedNotice).toBe(true);
  expect(f.element.childElementCount).toBe(0);
  const next = mountEditor(f.element, { editor: f.editor });
  await next.ready;
  expect(next.status).toBe('ready');
});

test('destruction during initialization cancels readiness, releases the attachment and cannot paint late', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const diagnostics = createViewDiagnostics();
  const view = mountEditor(f.element, { editor: f.editor, diagnostics });
  expect(factoryCounts.get(f.editor)).toBe(1);
  expect(() => mountEditor(f.element, { editor: f.editor })).toThrow(/one mounted view/);
  expect(factoryCounts.get(f.editor)).toBe(1);
  view.destroy();
  expect(factoryCounts.get(f.editor)).toBe(0);
  await expect(view.ready).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.element.childElementCount).toBe(0);
  expect(diagnostics.read()).toBeNull();
  const next = mountEditor(f.element, { editor: f.editor, diagnostics });
  await next.ready;
  await frame();
  expect(f.element.querySelectorAll('canvas')).toHaveLength(1);
  expect(next.status).toBe('ready');
  expect(diagnostics.read()?.blocks).toBe(3);
});

test('a diagnostics handle rejects simultaneous mounts without releasing the first view', async ({
  onTestFinished,
}) => {
  const first = fixture();
  const second = fixture();
  onTestFinished(() => {
    first.destroy();
    second.destroy();
  });
  const diagnostics = createViewDiagnostics();
  const view = mountEditor(first.element, { editor: first.editor, diagnostics });
  await view.ready;
  expect(() => mountEditor(second.element, { editor: second.editor, diagnostics })).toThrow(
    /already has a mounted view/,
  );
  expect(second.element.childElementCount).toBe(0);
  expect(diagnostics.read()?.blocks).toBe(3);
  const independent = mountEditor(second.element, { editor: second.editor });
  await independent.ready;
  expect(view.status).toBe('ready');
  view.destroy();
  expect(independent.status).toBe('ready');
});

test('asset failure cleans up the view and permits retry on the same live session', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const diagnostics = createViewDiagnostics();

  const view = mountEditor(f.element, {
    editor: f.editor,
    diagnostics,
    resolveAsset: () => 'data:application/wasm,invalid',
  });

  await expect(view.ready).rejects.toThrow(/Invalid graphics/);
  expect(view.status).toBe('failed');
  expect(f.element.childElementCount).toBe(0);
  expect(f.editor.isDestroyed).toBe(false);
  expect(diagnostics.read()).toBeNull();
  const next = mountEditor(f.element, { editor: f.editor, diagnostics });
  await next.ready;
  view.destroy();
  expect(next.status).toBe('ready');
  expect(diagnostics.read()?.blocks).toBe(3);
});

test('opt-in diagnostics expose copied counters and matching layout/paint reports without native handles', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const diagnostics = createViewDiagnostics({ composition: 'eager', retention: 'all' });
  const events: DiagnosticEvent[] = [];
  const unsubscribe = diagnostics.subscribe((event) => events.push(event));
  const view = mountEditor(f.element, { editor: f.editor, diagnostics });
  expect(diagnostics.read()).toBeNull();
  await view.ready;
  await expect.poll(() => events.some((event) => event.type === 'paint')).toBe(true);
  const snapshot = diagnostics.read();

  if (!snapshot) throw new Error('Expected diagnostics');
  expect(snapshot.blocks).toBe(3);
  expect(snapshot.pending).toBe(0);
  expect(snapshot.mounted).toEqual([3]);
  expect(snapshot.memory.wasmLinearBytes).toBeGreaterThan(0);
  expect(snapshot.stats.paragraphs).toBeGreaterThan(0);
  const placements = diagnostics.placements([1]);
  expect(placements).toHaveLength(1);
  expect(placements[0]).toMatchObject({ id: 1, resident: true });
  expect(placements[0]).not.toHaveProperty('layout');
  expect(placements[0]).not.toHaveProperty('node');

  const probe = {
    id: 1,
    range: { from: 0, to: 6 },
    hit: { x: 10, y: 10 },
    move: { offset: 0, direction: 'end' as const },
  };

  const inspection = diagnostics.inspectText(probe);

  if (!inspection) throw new Error('Expected resident text inspection');
  expect(inspection.geometry.rects.length).toBeGreaterThan(0);
  inspection.lines[0].start = 999;
  expect(diagnostics.inspectText(probe)?.lines[0].start).toBe(0);
  expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  expect(Object.isFrozen(snapshot.stats)).toBe(true);
  expect(Object.isFrozen(placements[0].boxes)).toBe(true);
  expect(events.every((event) => Object.isFrozen(event))).toBe(true);
  expect(
    events.filter((event) => event.type === 'layout').flatMap((event) => event.layoutIds),
  ).toContain(1);
  f.editor.transact((draft) => {
    draft.step({ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'Changed ' });

    return true;
  });
  await expect
    .poll(() =>
      events.some((event) => event.type === 'paint' && event.revision === f.editor.state.revision),
    )
    .toBe(true);
  expect(snapshot.revision).toBe(0);
  expect(diagnostics.read()?.revision).toBe(f.editor.state.revision);
  expect(events.some((event) => event.type === 'paint' && event.stale)).toBe(false);
  unsubscribe();
  view.destroy();
  expect(diagnostics.read()).toBeNull();
  expect(diagnostics.placements()).toEqual([]);
  const count = events.length;
  const next = mountEditor(f.element, { editor: f.editor, diagnostics });
  await next.ready;
  await frame();
  expect(events).toHaveLength(count);
  expect(diagnostics.read()?.blocks).toBe(3);
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
  await expect.poll(() => view.getSnapshot()?.viewport.top ?? 0).toBeGreaterThan(500);
  expect(view.blockBounds(80)?.top).toBeGreaterThan(500);
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
  view.update({ zoom: 1.5 });
  const target = { id: 40, offset: 3 };
  const canvas = f.element.querySelector('canvas');

  if (!canvas) throw new Error('Expected canvas');
  expect(await view.reveal(target, { align: 'start', margin: 24 })).toBe(true);
  expect(view.coordsAt(target)?.top).toBeCloseTo(canvas.getBoundingClientRect().top + 24, 0);
  expect(await view.reveal(target, { align: 'end', margin: 24 })).toBe(true);
  expect(view.coordsAt(target)?.bottom).toBeCloseTo(canvas.getBoundingClientRect().bottom - 24, 0);
  expect(await view.reveal(target, { align: 'center' })).toBe(true);
  const centered = view.coordsAt(target);

  if (!centered) throw new Error('Expected revealed coordinates');
  expect(centered.top + centered.height / 2).toBeCloseTo(
    canvas.getBoundingClientRect().top + canvas.getBoundingClientRect().height / 2,
    0,
  );
  expect(await view.reveal({ id: 1, offset: 0 }, { align: 'center' })).toBe(true);
  expect(() => view.reveal(target, { margin: -1 })).toThrow(/margin/);
  expect(f.editor.state.selection.eq(selection)).toBe(true);
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

test('a centered column keeps outer editor margins clickable and updates paint independently of text layout', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const diagnostics = createViewDiagnostics();
  const view = mountEditor(f.element, { editor: f.editor, maxWidth: 300, diagnostics });
  await view.ready;
  const canvas = f.element.querySelector('canvas');
  const root = f.element.querySelector('[data-editor-view]');

  if (!canvas || !root) throw new Error('Expected mounted editor');
  expect(canvas.getBoundingClientRect().width).toBe(300);
  expect(canvas.getBoundingClientRect().left - f.element.getBoundingClientRect().left).toBe(60);
  const point = view.coordsAt({ id: 2, offset: 0 });

  if (!point) throw new Error('Expected second block coordinates');
  await userEvent.click(root, {
    position: { x: 5, y: point.top - root.getBoundingClientRect().top + 2 },
  });
  expect(f.editor.state.selection).toMatchObject({ head: { id: 2, offset: 0 } });
  await frame();
  const compositions = diagnostics.read()?.stats.compositions;
  view.update({ background: '#fffef9' });
  await frame();
  expect(diagnostics.read()?.stats.compositions).toBe(compositions);
  expect(getComputedStyle(root).backgroundColor).toBe('rgb(255, 254, 249)');
  expect([...canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 0, 0]);
  const client = view.blockBounds(2, 'client');
  expect(client?.top).toBeCloseTo(point.top, 0);
  view.update({ maxWidth: null });
  await expect.poll(() => view.getSnapshot()?.viewport.width).toBe(420);
  expect(canvas.getBoundingClientRect().width).toBe(420);
});

test('public mounts resolve their configured font family independently', async ({
  onTestFinished,
}) => {
  const first = fixture();
  const second = fixture();
  onTestFinished(() => {
    first.destroy();
    second.destroy();
  });
  const regular = mountEditor(first.element, { editor: first.editor });

  const display = mountEditor(second.element, {
    editor: second.editor,
    fonts: {
      ...defaultFonts,
      defaultFamily: 'Display',
      faces: [...defaultFonts.faces, { ...defaultFonts.faces[1], family: 'Display', weight: 400 }],
    },
  });

  await Promise.all([regular.ready, display.ready]);
  const start = { id: 1, offset: 0 };
  const end = { id: 1, offset: 16 };
  const regularWidth = regular.coordsAt(end)!.left - regular.coordsAt(start)!.left;
  const displayWidth = display.coordsAt(end)!.left - display.coordsAt(start)!.left;
  expect(displayWidth).not.toBe(regularWidth);
  display.destroy();
  expect(regular.coordsAt(end)).not.toBeNull();
  expect(regular.coordsAt(end)!.left - regular.coordsAt(start)!.left).toBe(regularWidth);
});

test('live themes preserve selection and native node identity with independent per-view metrics', async ({
  onTestFinished,
}) => {
  const first = fixture();
  const second = fixture();
  onTestFinished(() => {
    first.destroy();
    second.destroy();
  });
  const diagnostics = createViewDiagnostics();
  const a = mountEditor(first.element, { editor: first.editor, diagnostics });
  const b = mountEditor(second.element, { editor: second.editor });
  a.update({ theme: { baselineGrid: 0, rules: [defineStyleRule(note, { lineHeight: 40 })] } });
  await Promise.all([a.ready, b.ready]);
  const plain = b.coordsAt({ id: 1, offset: 5 });
  expect(a.coordsAt({ id: 1, offset: 5 })?.height).toBe(40);
  expect(plain?.height).toBe(28);
  const canvas = first.element.querySelector('canvas');
  const input = capture(first.element);
  const button = first.element.querySelector('button');
  const original = first.editor.state;
  const glyphs = diagnostics.read()?.stats.glyphCalls;
  a.focus();
  a.update({
    theme: { baselineGrid: 0, rules: [defineStyleRule(note, { lineHeight: 48, after: 24 })] },
  });
  expect(a.coordsAt({ id: 1, offset: 5 })?.height).toBe(48);
  expect(diagnostics.read()?.stats.glyphCalls).toBe(glyphs);
  expect(first.editor.state).toBe(original);
  expect(document.activeElement).toBe(input);
  expect(first.element.querySelector('canvas')).toBe(canvas);
  expect(first.element.querySelector('button')).toBe(button);
  expect(b.coordsAt({ id: 1, offset: 5 })).toEqual(plain);
  const next = a.getSnapshot();
  expect(() => a.update({ theme: { baselineGrid: -1 } })).toThrow(/baselineGrid/);
  expect(a.getSnapshot()).toBe(next);
  expect(a.status).toBe('ready');
  button?.focus();
  a.update({ theme: { rules: [defineStyleRule(note, { size: 26, font: { weight: 700 } })] } });
  expect(first.element.querySelector('button')).toBe(button);
  expect(document.activeElement).toBe(button);
  expect(a.coordsAt({ id: 1, offset: 5 })?.left).toBeGreaterThan(plain?.left ?? 0);
  expect(diagnostics.read()?.stats.glyphCalls).toBeGreaterThan(glyphs ?? 0);
  a.update({ theme: {} });
  expect(a.coordsAt({ id: 1, offset: 5 })?.height).toBe(28);
});

test('metric theme changes reflow around a distant scroll anchor without changing the selected position', async ({
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
      nodes: Array.from({ length: 500 }, (_, index) =>
        schema.node(note).create(
          { id: index + 4, key: `theme-${index}` },
          {
            body: `Paragraph ${index} with words that wrap onto several lines when the type grows. `.repeat(
              3,
            ),
          },
        ),
      ),
    });

    return true;
  });
  const diagnostics = createViewDiagnostics();
  const view = mountEditor(f.element, { editor: f.editor, diagnostics });
  await view.ready;
  f.editor.select(textSelection(400, 3));
  await view.reveal({ id: 400, offset: 3 }, { align: 'start' });
  const selection = f.editor.state.selection;
  const before = view.blockBounds(400, 'client');
  const generation = diagnostics.read()?.generation ?? 0;
  view.update({
    theme: {
      baselineGrid: 0,
      rules: [defineStyleRule(note, { size: 22, lineHeight: 36, after: 20 })],
    },
  });
  expect(f.editor.state.selection).toBe(selection);
  expect(diagnostics.read()?.generation).toBe(generation + 1);
  expect(view.coordsAt({ id: 400, offset: 3 })?.height).toBe(36);
  await expect.poll(() => diagnostics.read()?.pending).toBe(0);
  expect(view.blockBounds(400, 'client')?.top).toBeCloseTo(before?.top ?? 0, 0);
  expect(view.getSnapshot()?.viewport.top).toBeGreaterThan(1000);
  expect(f.editor.state.selection).toBe(selection);
});

test('changing only a text color repaints pixels without shaping, composition, geometry or selection changes', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const diagnostics = createViewDiagnostics();
  const paints: DiagnosticEvent[] = [];
  diagnostics.subscribe((event) => {
    if (event.type === 'paint') paints.push(event);
  });
  const view = mountEditor(f.element, { editor: f.editor, diagnostics });
  await view.ready;
  await expect.poll(() => paints.length).toBeGreaterThan(0);
  const canvas = f.element.querySelector('canvas');

  if (!canvas) throw new Error('Expected editor canvas');
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Expected canvas pixels');
  const before = diagnostics.read();
  const point = view.coordsAt({ id: 1, offset: 5 });
  const bounds = view.blockBounds(2);
  const selection = f.editor.state.selection;
  const count = paints.length;
  view.update({ theme: { rules: [defineStyleRule(note, { color: 'rgb(255, 0, 0)' })] } });
  await expect.poll(() => paints.length).toBeGreaterThan(count);
  const after = diagnostics.read();
  expect(after?.stats.glyphCalls).toBe(before?.stats.glyphCalls);
  expect(after?.stats.compositions).toBe(before?.stats.compositions);
  expect(after?.generation).toBe(before?.generation);
  expect(view.coordsAt({ id: 1, offset: 5 })).toEqual(point);
  expect(view.blockBounds(2)).toEqual(bounds);
  expect(f.editor.state.selection).toBe(selection);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let redPixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index] > 180 && data[index + 1] < 80 && data[index + 2] < 80) redPixels++;
  }

  expect(redPixels).toBeGreaterThan(50);
  const colored = paints.length;
  view.update({ theme: {} });
  await expect.poll(() => paints.length).toBeGreaterThan(colored);
  expect(diagnostics.read()?.stats.compositions).toBe(before?.stats.compositions);
  expect(diagnostics.read()?.generation).toBe(before?.generation);
});

test('font replacement preserves the mounted view, distant reading anchor and selection', async ({
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
      nodes: Array.from({ length: 500 }, (_, index) =>
        schema
          .node(note)
          .create(
            { id: index + 4, key: `font-${index}` },
            { body: `Paragraph ${index} with words that wrap across multiple lines. `.repeat(4) },
          ),
      ),
    });

    return true;
  });
  const diagnostics = createViewDiagnostics();
  const view = mountEditor(f.element, { editor: f.editor, diagnostics });
  await view.ready;
  f.editor.select(textSelection(400, 20));
  await view.reveal({ id: 400, offset: 20 }, { align: 'start' });
  view.focus();
  const input = capture(f.element);
  const canvas = f.element.querySelector('canvas');
  const selected = f.editor.state.selection;
  const before = view.blockBounds(400, 'client');
  const caret = view.coordsAt({ id: 400, offset: 20 });
  const generation = diagnostics.read()?.generation ?? 0;
  await view.setFonts({
    ...defaultFonts,
    faces: defaultFonts.faces.map((face, index) =>
      index === 0 ? { ...face, asset: defaultFonts.faces[1].asset } : face,
    ),
  });
  expect(view.status).toBe('ready');
  expect(f.element.querySelector('canvas')).toBe(canvas);
  expect(capture(f.element)).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(f.editor.state.selection).toBe(selected);
  expect(view.coordsAt({ id: 400, offset: 20 })?.left).not.toBe(caret?.left);
  expect(diagnostics.read()?.generation).toBe(generation + 1);
  expect(diagnostics.read()?.pending).toBeGreaterThan(0);
  await expect.poll(() => diagnostics.read()?.pending).toBe(0);
  expect(view.blockBounds(400, 'client')?.top).toBeCloseTo(before?.top ?? 0, 0);
  expect(view.getSnapshot()?.viewport.top).toBeGreaterThan(1000);
  await view.setFonts(defaultFonts);
  expect(view.coordsAt({ id: 400, offset: 20 })?.left).toBeCloseTo(caret?.left ?? 0, 1);
  expect(f.editor.state.selection).toBe(selected);
});

test('font replacement requested during initial readiness preserves the attachment', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const view = mountEditor(f.element, { editor: f.editor });
  await view.setFonts(defaultFonts);
  expect(view.status).toBe('ready');
  expect(f.element.querySelectorAll('canvas')).toHaveLength(1);
  expect(view.coordsAt({ id: 1, offset: 3 })).not.toBeNull();
});

test('invalid fixed theme colors reject without losing the working view or subsequent editing', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  const diagnostics = createViewDiagnostics();

  const view = mountEditor(f.element, {
    editor: f.editor,
    diagnostics,
    theme: { rules: [defineStyleRule(note, { lineHeight: 40, color: 'blue' })] },
  });

  await view.ready;
  f.editor.select(textSelection(1, 4));
  view.focus();
  await frame();
  const selection = f.editor.state.selection;
  const input = capture(f.element);
  const canvas = f.element.querySelector('canvas');
  const before = view.coordsAt({ id: 1, offset: 4 });
  const snapshot = diagnostics.read();

  for (const color of ['not-a-color', 'var(--text)', 'currentColor']) {
    expect(() =>
      view.update({
        zoom: 2,
        paddingTop: 96,
        theme: { rules: [defineStyleRule(note, { lineHeight: 60, color })] },
      }),
    ).toThrow(/text color|CSS color/);
    expect(view.status).toBe('ready');
    expect(view.error).toBeUndefined();
    expect(capture(f.element)).toBe(input);
    expect(f.element.querySelector('canvas')).toBe(canvas);
    expect(document.activeElement).toBe(input);
    expect(view.coordsAt({ id: 1, offset: 4 })).toEqual(before);
    expect(view.getSnapshot()?.zoom).toBe(1);
    expect(f.editor.state.selection).toBe(selection);
    expect(diagnostics.read()?.generation).toBe(snapshot?.generation);
    expect(diagnostics.read()?.stats.glyphCalls).toBe(snapshot?.stats.glyphCalls);
  }

  input.setRangeText('!', input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '!' }),
  );
  await frame();
  expect(f.editor.state.nodes[0]).toMatchObject({ body: 'Firs!t line of a custom schema.' });
  expect(view.coordsAt({ id: 1, offset: 5 })?.height).toBe(40);
});

test('an invalid initial fixed color rejects before DOM or resource ownership is acquired', async ({
  onTestFinished,
}) => {
  const f = fixture();
  onTestFinished(() => f.destroy());
  let assets = 0;
  expect(() =>
    mountEditor(f.element, {
      editor: f.editor,
      theme: { rules: [defineStyleRule(note, { color: 'var(--text)' })] },
      resolveAsset(asset) {
        assets++;

        return `/${asset}`;
      },
    }),
  ).toThrow(/standalone CSS color/);
  expect(assets).toBe(0);
  expect(f.element.childElementCount).toBe(0);
  const view = mountEditor(f.element, { editor: f.editor });
  await view.ready;
  expect(view.status).toBe('ready');
});
