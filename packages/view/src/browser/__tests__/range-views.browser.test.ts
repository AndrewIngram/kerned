import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { createSchema, defineMark, defineNode, indexTree } from '@kerned/model';
import { textSelection } from '@kerned/state';
import { defineNodePresentation, presentations, mountEditor } from '@kerned/view';
import { defineMarkView, viewLayers, type RangeViewMount } from '@kerned/view';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createViewLayers } from '../view-layers.js';

const note = defineNode({
  name: 'note',
  version: 1,
  options: {},
  schema: () => ({
    attributes: z.strictObject({ text: z.string() }),
    content: { kind: 'text', field: 'text', marks: 'marks' },
  }),
});

test('mark projection caches evict culled geometry even while the document retains its nodes', ({
  onTestFinished,
}) => {
  const subscriptions = new Set<() => void>();

  const extension = defineExtension({
    name: 'ranges',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(
        viewLayers,
        defineMarkView(review, ({ invalidate, onDestroy }) => {
          subscriptions.add(invalidate);
          onDestroy(() => {
            subscriptions.delete(invalidate);
          });

          return () => ({ update() {}, destroy() {} });
        }),
      );

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [note, review, extension] }),
    content: [1, 2].map((id) => ({
      kind: 'note' as const,
      id,
      text: 'Marked text.',
      marks: [{ from: 0, to: 6, mark: { type: 'review' as const, attrs: null } }],
    })),
  });

  const element = document.createElement('div');
  let painters = 0;

  const layers = createViewLayers(element, editor, {
    register() {
      painters++;

      return () => {};
    },
    prepareText() {
      throw new Error('No labels in this fixture');
    },
  });

  onTestFinished(() => {
    layers.destroy();
    editor.destroy();
  });
  let projections = 0;

  const text = {
    caret: () => ({ left: 0, top: 0, width: 1, height: 24 }),
    fragments() {
      projections++;

      return [{ left: 0, top: 0, width: 60, height: 24, baseline: 20 }];
    },
  };

  const tree = indexTree(editor.schema, editor.state.nodes);
  const insets = new Map<number, { inset: number }>();

  function show(index: number) {
    layers.update({
      tree,
      insets,
      inset: 28,
      width: 400,
      blocks: [{ node: editor.state.nodes[index], y: 0, height: 40, text, inline: [] }],
    });
  }

  show(0);
  show(0);
  expect(projections).toBe(1);
  editor.select(textSelection(1, 3));
  show(0);
  expect(projections).toBe(1);
  show(1);
  expect(projections).toBe(2);
  show(0);
  expect(projections).toBe(3);
  expect(painters).toBe(0);
  expect(subscriptions.size).toBe(1);
  layers.update({ tree, insets, inset: 28, width: 400, blocks: [] });
  expect(subscriptions.size).toBe(1);
  const stale = [...subscriptions][0];
  layers.destroy();
  expect(editor.isDestroyed).toBe(false);
  expect(subscriptions.size).toBe(0);
  expect(() => stale()).not.toThrow();

  const remounted = createViewLayers(element, editor, {
    register: () => () => {},
    prepareText: () => {
      throw new Error('No labels');
    },
  });

  expect(subscriptions.size).toBe(1);
  remounted.destroy();
  remounted.destroy();
  expect(subscriptions.size).toBe(0);
});

const review = defineMark({
  name: 'review',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.null() }),
});

test('canvas mark instances allocate overlays lazily, coalesce external updates and release every instance after an error', async ({
  onTestFinished,
}) => {
  const mounts: RangeViewMount[] = [];
  const updates: number[] = [];
  const removed: number[] = [];
  let invalidate: (() => void) | undefined;
  let overlay = false;
  let fail = false;
  let painted = 0;
  let factoryLive = 0;

  const extension = defineExtension({
    name: 'view',
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
          atoms: [],
          spans: [],
        })),
      );
      context.provide(
        viewLayers,
        defineMarkView(review, (view) => {
          invalidate = view.invalidate;
          factoryLive++;
          view.onDestroy(() => {
            factoryLive--;
          });

          return (scope) => {
            const id = mounts.length;
            mounts.push(scope);

            return {
              update() {
                updates.push(id);

                if (fail) throw new Error('Update failed');

                if (overlay) {
                  const element = scope.createOverlay();
                  expect(scope.createOverlay()).toBe(element);
                  element.dataset.instance = String(id);
                }
              },
              draw(drawing, layer) {
                if (layer !== 'background') return;
                painted++;
                drawing.rect({ left: 0, top: 0, width: 2, height: 2 }, '#ffff00');
              },
              destroy() {
                removed.push(id);

                if (id === 0 && fail) throw new Error('Cleanup failed');
              },
            };
          };
        }),
      );

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [note, review, extension] }),
    content: [
      {
        kind: 'note',
        text: 'First and second marked ranges.',
        marks: [
          { from: 0, to: 5, mark: { type: 'review', attrs: null } },
          { from: 10, to: 16, mark: { type: 'review', attrs: null } },
        ],
      },
    ],
  });

  const element = document.createElement('div');
  element.style.cssText = 'width:400px;height:400px;';
  document.body.append(element);
  const failures: Error[] = [];
  const view = mountEditor(element, { editor, onError: (error) => failures.push(error) });
  onTestFinished(() => {
    view.destroy();
    editor.destroy();
    element.remove();
  });
  await view.ready;
  expect(mounts.length).toBe(2);
  expect(updates).toEqual([0, 1]);
  await expect.poll(() => painted).toBeGreaterThan(0);
  expect(element.querySelector('[data-editor-layer="mark:review"]')?.children.length).toBe(0);
  overlay = true;
  const beforePaint = painted;
  invalidate?.();
  invalidate?.();
  await expect.poll(() => element.querySelectorAll('[data-instance]').length).toBe(2);
  await expect.poll(() => painted).toBeGreaterThan(beforePaint);
  expect(updates).toEqual([0, 1, 0, 1]);
  fail = true;
  invalidate?.();
  await expect.poll(() => view.status).toBe('failed');
  expect(removed.toSorted((a, b) => a - b)).toEqual([0, 1]);
  expect(element.children.length).toBe(0);
  expect(failures.length).toBe(1);
  expect(editor.isDestroyed).toBe(false);
  expect(factoryLive).toBe(0);
  expect(() => mounts[0].createOverlay()).toThrow(/destroyed/);
  expect(() => mounts[1].createOverlay()).toThrow(/destroyed/);
});
