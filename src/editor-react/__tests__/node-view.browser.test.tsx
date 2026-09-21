import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { createEditor, defineExtension, type ContributionContext } from '../../core';
import { createNodeViews, defineNodeView, nodeViews } from '../../editor-browser/node-views';
import { createSchema, defineNode } from '../../model';
import { NodeViewContent } from '../node-view';

const card = defineNode({
  name: 'card',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({ label: z.string() }), content: { kind: 'atom' } }),
});

function onMeasure() {}

test('React strict remounts use the contributed native lifecycle and tolerate borrowed-session destruction', ({
  onTestFinished,
}) => {
  let live = 0;

  const extension = defineExtension({
    name: 'cardView',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(
        nodeViews,
        defineNodeView(card, () => (element) => {
          live++;

          return {
            update: ({ attributes }) => {
              element.textContent = attributes.label;
            },
            destroy() {
              live--;
              element.replaceChildren();
            },
          };
        }),
      );

      return {};
    },
  });

  const editor = createEditor({
    schema: createSchema({ extensions: [card, extension] }),
    content: [{ kind: 'card', label: 'First' }],
  });

  const renderer = createNodeViews(editor).find(editor.state.nodes[0]);

  if (!renderer) throw new Error('Missing node view');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  onTestFinished(() => {
    flushSync(() => root.unmount());
    editor.destroy();
    host.remove();
  });

  const node = editor.state.nodes[0];

  const render = (next: typeof node, key: string) =>
    flushSync(() =>
      root.render(
        <StrictMode>
          <NodeViewContent
            key={key}
            renderer={renderer}
            node={next}
            width={200}
            onMeasure={onMeasure}
          />
        </StrictMode>,
      ),
    );

  render({ ...node, label: 'First' }, 'one');
  expect(host.textContent).toBe('First');
  expect(live).toBe(1);
  render({ ...node, label: 'Changed' }, 'one');
  expect(host.textContent).toBe('Changed');
  expect(live).toBe(1);
  render({ ...node, label: 'Remounted' }, 'two');
  expect(host.textContent).toBe('Remounted');
  expect(live).toBe(1);
  editor.destroy();
  expect(live).toBe(0);
  expect(host.textContent).toBe('');
  render({ ...node, label: 'Obsolete update' }, 'two');
  render({ ...node, label: 'Obsolete mount' }, 'three');
  expect(host.textContent).toBe('');
  expect(live).toBe(0);
});
