import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { createSchema, defineNode } from '@kerned/model';
import { NodeSelection, selectionContext } from '@kerned/state';
import {
  defineNodePresentation,
  defineNodeView,
  mountEditor,
  nodeViews,
  presentations,
} from '@kerned/view';
import { z } from 'zod';

const atom = defineNode({
  name: 'atom',
  version: 1,
  options: {},
  schema: () => ({ attributes: z.strictObject({ label: z.string() }), content: { kind: 'atom' } }),
});

const browser = defineExtension({
  name: 'atoms',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(atom, () => () => ({
        kind: 'box',
        height: 80,
        before: 0,
        after: 0,
        baselineGrid: 1,
      })),
    );
    context.provide(
      nodeViews,
      defineNodeView(atom, () => (element) => ({
        update({ attributes, node, width, onMeasure }) {
          element.dataset.atom = String(node.id);
          element.textContent = attributes.label;
          element.style.height = '80px';
          onMeasure(node.id, width, 80);
        },
        destroy() {},
      })),
    );

    return {};
  },
});

export async function mountNodeOnly() {
  const schema = createSchema({ extensions: [atom, browser] });

  const editor = createEditor({
    schema,
    content: [
      { kind: 'atom', id: 1, label: 'One' },
      { kind: 'atom', id: 2, label: 'Two' },
    ],
    selection: new NodeSelection(1),
  });

  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:100px 100px auto;z-index:100;background:white;height:300px';
  document.body.append(host);
  const view = mountEditor(host, { editor });
  await view.ready;
  window.addEventListener('pagehide', () => editor.destroy(), { once: true });

  return () => ({
    type: editor.state.selection.type,
    ranges: editor.state.selection.ranges(selectionContext(schema, editor.state.nodes)),
  });
}
