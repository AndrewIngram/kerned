import { createEditor, defineExtension, type ContributionContext } from '@gprose/core';
import { createSchema, defineNode, indexTree } from '@gprose/model';
import { expect, test } from 'vitest';
import { z } from 'zod';

import type { RegisterDrawing } from '../drawing';
import { createViewLayers, viewLayers, type ViewLayerContribution } from '../view-layers';

const card = defineNode({
  name: 'card',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({}), content: { kind: 'atom' } }),
});

function painting() {
  const active = new Set<symbol>();

  const register: RegisterDrawing = () => {
    const token = Symbol();
    active.add(token);

    return () => {
      active.delete(token);
    };
  };

  return {
    active,
    register,
    prepareText: () => {
      throw new Error('No text in this fixture');
    },
  };
}

function fixture(contributions: readonly ViewLayerContribution[]) {
  const extension = defineExtension({
    name: 'overlays',
    options: {},
    setup(_options, context: ContributionContext) {
      for (const contribution of contributions) context.provide(viewLayers, contribution);

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [card, extension] }),
    content: [{ kind: 'card', id: 1 }],
  });

  const host = document.createElement('div');
  document.body.append(host);

  return {
    editor,
    host,
    destroy() {
      editor.destroy();
      host.remove();
    },
  };
}

test('composed layers receive canonical visible blocks and clean up independently per view', ({
  onTestFinished,
}) => {
  const released: string[] = [];
  const drawing = painting();

  const contributions: ViewLayerContribution[] = ['first', 'second'].map((name) => ({
    name,
    create({ element, editor, paint }) {
      paint('content', () => {});
      paint('content', () => {});
      const button = document.createElement('button');
      button.style.pointerEvents = 'auto';
      element.append(button);

      return {
        update(frame) {
          expect(frame.blocks[0].node).toBe(editor.state.nodes[0]);
          expect(frame.blocks[0].ancestors).toEqual([]);
          button.textContent = `${frame.blocks[0].left}:${frame.blocks[0].top}`;
        },
        destroy() {
          released.push(name);

          if (name === 'second') throw new Error('Second failed');
        },
      };
    },
  }));

  const a = fixture(contributions);
  const b = fixture(contributions);
  const first = createViewLayers(a.host, a.editor, drawing);
  const second = createViewLayers(b.host, b.editor, drawing);
  expect(drawing.active.size).toBe(4);
  onTestFinished(() => {
    a.destroy();
    b.destroy();
  });
  first.update({
    tree: indexTree(a.editor.schema, a.editor.state.nodes),
    insets: new Map(),
    blocks: [{ node: a.editor.state.nodes[0], y: 32, height: 40, text: null, inline: [] }],
    inset: 28,
    width: 400,
  });
  expect(a.host.querySelector('button')?.textContent).toBe('28:32');
  expect(a.host.querySelector('[aria-hidden]')).toBeNull();
  expect(() => first.destroy()).toThrow('View layer cleanup failed');
  expect(released).toEqual(['second', 'first']);
  expect(a.host.childElementCount).toBe(0);
  expect(b.host.childElementCount).toBe(2);
  expect(drawing.active.size).toBe(2);
  first.destroy();
  expect(() => second.destroy()).toThrow('View layer cleanup failed');
  expect(released).toEqual(['second', 'first', 'second', 'first']);
  expect(b.host.childElementCount).toBe(0);
  expect(drawing.active.size).toBe(0);
});

test('layer installation rejects duplicate names before allocation and unwinds failed factories', ({
  onTestFinished,
}) => {
  let created = 0;
  let released = 0;
  const resources: string[] = [];
  const drawing = painting();

  const good: ViewLayerContribution = {
    name: 'same',
    create({ paint, onDestroy }) {
      onDestroy(() => resources.push('good'));
      created++;
      paint('background', () => {});

      return {
        update() {},
        destroy() {
          released++;
        },
      };
    },
  };

  const duplicate = fixture([good, good]);

  const failed = fixture([
    good,
    {
      name: 'failure',
      create({ paint, onDestroy }) {
        onDestroy(() => resources.push('failed'));
        paint('content', () => {});
        throw new Error('Factory failed');
      },
    },
  ]);

  onTestFinished(() => {
    duplicate.destroy();
    failed.destroy();
  });
  expect(() => createViewLayers(duplicate.host, duplicate.editor, drawing)).toThrow(
    'Duplicate view layer',
  );
  expect(created).toBe(0);
  expect(duplicate.host.childElementCount).toBe(0);
  expect(() => createViewLayers(failed.host, failed.editor, drawing)).toThrow('Factory failed');
  expect(created).toBe(1);
  expect(released).toBe(1);
  expect(resources).toEqual(['failed', 'good']);
  expect(failed.host.childElementCount).toBe(0);
  expect(drawing.active.size).toBe(0);
});

test('external invalidation coalesces per layer and releases scoped event listeners', async ({
  onTestFinished,
}) => {
  const updates = [0, 0];
  const invalidations: (() => void)[] = [];
  const clicks: number[] = [];

  const f = fixture(
    [0, 1].map((index) => ({
      name: `layer-${index}`,
      create({ invalidate, listen, nodeAt }) {
        invalidations.push(invalidate);
        listen('click', (event) => {
          const node = nodeAt(event.target);

          if (node) clicks.push(node.id);
        });

        return {
          update() {
            updates[index]++;
          },
          destroy() {},
        };
      },
    })),
  );

  const layers = createViewLayers(f.host, f.editor, painting());
  onTestFinished(() => {
    layers.destroy();
    f.destroy();
  });
  const node = document.createElement('div');
  node.dataset.editorNode = '1';
  f.host.append(node);
  invalidations[0]();
  layers.update({
    tree: indexTree(f.editor.schema, f.editor.state.nodes),
    insets: new Map(),
    blocks: [{ node: f.editor.state.nodes[0], y: 0, height: 40, text: null, inline: [] }],
    inset: 0,
    width: 400,
  });
  expect(updates).toEqual([1, 1]);
  invalidations[0]();
  invalidations[0]();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(updates).toEqual([2, 1]);
  node.click();
  expect(clicks).toEqual([1, 1]);
  invalidations[1]();
  layers.destroy();
  node.click();
  invalidations[0]();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(updates).toEqual([2, 1]);
  expect(clicks).toEqual([1, 1]);
});

test('external update errors reach the owner and release pending layer resources', async ({
  onTestFinished,
}) => {
  const errors: Error[] = [];
  let invalidate = () => {};

  let fail = false;

  const f = fixture([
    {
      name: 'external',
      create(context) {
        invalidate = context.invalidate;
        context.paint('background', () => {});

        return {
          update() {
            if (fail) throw new Error('External update failed');
          },
          destroy() {},
        };
      },
    },
  ]);

  const drawing = painting();

  const layers = createViewLayers(f.host, f.editor, drawing, {
    onError(error) {
      errors.push(error);
      layers.destroy();
    },
  });

  onTestFinished(() => {
    layers.destroy();
    f.destroy();
  });
  layers.update({
    tree: indexTree(f.editor.schema, f.editor.state.nodes),
    insets: new Map(),
    blocks: [],
    inset: 0,
    width: 400,
  });
  fail = true;
  invalidate();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(errors.map((error) => error.message)).toEqual(['External update failed']);
  expect(drawing.active.size).toBe(0);
  expect(f.host.children).toHaveLength(0);
});
