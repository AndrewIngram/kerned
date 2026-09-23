import { createEditor, defineExtension, type ContributionContext } from '@kerned/core';
import { createMention } from '@kerned/extension-document';
import { createSchema, defineInline } from '@kerned/model';
import { starterBrowserExtensions } from '@kerned/starter-kit/browser';
import {
  defineInlinePresentation,
  defineInlineView,
  inlinePresentations,
  mountEditor,
  viewLayers,
} from '@kerned/view';
import { z } from 'zod';

export const badge = defineInline(
  {
    name: 'badge',
    version: 1,
    options: {},
    schema: () => ({ attributes: z.strictObject({ code: z.string() }) }),
  },
  (attributes) => attributes.code,
);

export const badgeView = defineExtension({
  name: 'badgeView',
  requires: [badge.name],
  options: { width: 76 },
  setup(options, context: ContributionContext) {
    context.provide(
      inlinePresentations,
      defineInlinePresentation(badge, () => (attributes) => ({
        width: options.width,
        ascent: 24,
        descent: 6,
        label: attributes.code,
      })),
    );
    context.provide(
      viewLayers,
      defineInlineView(badge, () => ({ createOverlay }) => {
        const element = createOverlay();
        element.dataset.badge = '';

        return {
          update(frame) {
            element.textContent = frame.attributes.code;
            element.dataset.width = String(frame.width);
          },
          destroy() {},
        };
      }),
    );

    return {};
  },
});

export function mountInlineConsumer(host: HTMLElement, width = 76) {
  const schema = createSchema({
    extensions: [...starterBrowserExtensions(), badge, badgeView.configure({ width })],
  });

  const inline = [
    schema.inline.create('badge', 'custom', 1, { code: 'ABC' }),
    createMention({ id: 'mention', index: 3, label: '@Ada', width: 90, ascent: 24, descent: 6 }),
  ];

  const editor = createEditor({
    schema,
    content: [
      { kind: 'paragraph', text: 'A\ufffcB\ufffcC', inline },
      { kind: 'heading', level: 2, text: 'A\ufffcB\ufffcC', inline },
    ],
  });

  const view = mountEditor(host, { editor });

  return { editor, view };
}
