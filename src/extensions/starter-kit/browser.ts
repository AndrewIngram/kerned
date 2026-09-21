import { defineExtension, type ContributionContext } from '../../core';
import { inputPolicies } from '../../editor-browser';
import { defineNodeView, nodeViews } from '../../editor-browser/node-views';
import { image } from '../starter-definitions';
import { createImageRenderer } from './image-view';
import { starterExtensions } from './index';
import { createStarterKitInput } from './input';
import { starterPresentation } from './presentation';
import { tableView } from './table-node-view';

export const imageView = defineExtension({
  name: 'imageView',
  requires: [image.name],
  options: { delay: 0 },
  setup(options, context: ContributionContext) {
    context.provide(
      nodeViews,
      defineNodeView(image, () => {
        const renderer = createImageRenderer(options);

        return (element) => {
          const view = renderer(element);

          return {
            update({ node, attributes, width, onMeasure }) {
              view.update({ node: { ...node, kind: 'image', ...attributes }, width, onMeasure });
            },
            destroy: () => view.destroy(),
          };
        };
      }),
    );

    return {};
  },
});

/** Browser composition shares the headless definitions and adds view capabilities. */
export function starterBrowserExtensions({ imageDelay = 0 }: { imageDelay?: number } = {}) {
  return [
    ...starterExtensions,
    imageView.configure({ delay: imageDelay }),
    starterInput,
    tableView,
    starterPresentation,
  ] as const;
}

/** Schema-specific editing policy installed through the same composed session. */
export const starterInput = defineExtension({
  name: 'starterInput',
  requires: ['starterEditing', 'starterFormatting', 'starterStructure', 'starterTables'],
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(inputPolicies, {
      create({ editor, input, textInput, selectAll, navigate, notice }) {
        const adapter = createStarterKitInput({
          editor,
          input: () => input,
          textInput,
          selectAll,
          navigate,
          notice,
        });

        return adapter.events;
      },
    });

    return {};
  },
});
