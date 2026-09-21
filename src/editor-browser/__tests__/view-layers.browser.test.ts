import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../core';
import { createSchema, defineNode, indexTree } from '../../model';
import { createViewLayers, viewLayers, type ViewLayerContribution } from '../view-layers';

const card = defineNode({
  name: 'card',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({}), content: { kind: 'atom' } }),
});

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

  const contributions: ViewLayerContribution[] = ['first', 'second'].map((name) => ({
    name,
    create({ element, editor }) {
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
  const first = createViewLayers(a.host, a.editor);
  const second = createViewLayers(b.host, b.editor);
  onTestFinished(() => {
    a.destroy();
    b.destroy();
  });
  first.update({
    tree: indexTree(a.editor.schema, a.editor.state.nodes),
    insets: new Map(),
    blocks: [{ node: a.editor.state.nodes[0], y: 32, height: 40 }],
    inset: 28,
    width: 400,
  });
  expect(a.host.querySelector('button')?.textContent).toBe('28:32');
  expect(a.host.querySelector('[aria-hidden]')).toBeNull();
  expect(() => first.destroy()).toThrow('View layer cleanup failed');
  expect(released).toEqual(['second', 'first']);
  expect(a.host.childElementCount).toBe(0);
  expect(b.host.childElementCount).toBe(2);
  first.destroy();
  expect(() => second.destroy()).toThrow('View layer cleanup failed');
  expect(released).toEqual(['second', 'first', 'second', 'first']);
  expect(b.host.childElementCount).toBe(0);
});

test('layer installation rejects duplicate names before allocation and unwinds failed factories', ({
  onTestFinished,
}) => {
  let created = 0;
  let released = 0;

  const good: ViewLayerContribution = {
    name: 'same',
    create() {
      created++;

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
      create() {
        throw new Error('Factory failed');
      },
    },
  ]);

  onTestFinished(() => {
    duplicate.destroy();
    failed.destroy();
  });
  expect(() => createViewLayers(duplicate.host, duplicate.editor)).toThrow('Duplicate view layer');
  expect(created).toBe(0);
  expect(duplicate.host.childElementCount).toBe(0);
  expect(() => createViewLayers(failed.host, failed.editor)).toThrow('Factory failed');
  expect(created).toBe(1);
  expect(released).toBe(1);
  expect(failed.host.childElementCount).toBe(0);
});
