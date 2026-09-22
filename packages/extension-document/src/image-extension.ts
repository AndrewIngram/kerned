import { defineExtension, type ContributionContext } from '@gprose/core';
import { defineNodeView, nodeViews } from '@gprose/view';

import { image } from './definitions.js';
import { createImageRenderer } from './image-view.js';

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
