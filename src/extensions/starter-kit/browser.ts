import { defineExtension, type ContributionContext } from '../../core';
import { defineNodeView, nodeViews } from '../../editor-browser/node-views';
import { image } from '../starter-definitions';
import { createImageRenderer } from './image-view';
import { starterExtensions } from './index';

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
  return [...starterExtensions, imageView.configure({ delay: imageDelay })] as const;
}
