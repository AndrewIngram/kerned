import { defineExtension, type ContributionContext } from '../../core';
import { inputPolicies, htmlParsers } from '../../editor-browser';
import { defineNodeView, nodeViews } from '../../editor-browser/node-views';
import { starterHtmlParsers } from '../html-parsers';
import { image } from '../starter-definitions';
import { containerDecorations } from './container-decorations';
import { createImageRenderer } from './image-view';
import { starterExtensions } from './index';
import { mentionView } from './mention-view';

export { mentionView, onMentionActivate, type MentionActivation } from './mention-view';

import { createStarterKitInput } from './input';
import { starterPresentation } from './presentation';
import { tableView } from './table-node-view';
import { underlineView } from './underline-view';

export { containerDecorations } from './container-decorations';

export { underlineView } from './underline-view';

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
export function starterBrowserExtensions({
  imageDelay = 0,
  bodySize = 18,
}: { imageDelay?: number; bodySize?: number } = {}) {
  return [
    ...starterExtensions,
    imageView.configure({ delay: imageDelay }),
    starterInput,
    tableView,
    starterPresentation.configure({ bodySize }),
    containerDecorations,
    underlineView,
    mentionView,
  ] as const;
}

/** Schema-specific editing policy installed through the same composed session. */
export const starterInput = defineExtension({
  name: 'starterInput',
  requires: ['starterEditing', 'starterFormatting', 'starterStructure', 'starterTables'],
  options: {},
  setup(_options, context: ContributionContext) {
    for (const rule of starterHtmlParsers) context.provide(htmlParsers, rule);

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
