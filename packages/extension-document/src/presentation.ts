import { defineExtension, type ContributionContext } from '@gprose/core';
import { defineNodePresentation, presentations } from '@gprose/view';

import { paragraph, heading, image, quote, list, listItem } from './definitions.js';
import { formattingSpans } from './formatting.js';
import { typography } from './typography.js';

/** Browser defaults are contributed alongside the installed schema; mounts discover them. */
export const documentPresentation = defineExtension({
  name: 'documentPresentation',
  options: { bodySize: 18 },
  requires: [paragraph.name, heading.name, image.name, quote.name, list.name, listItem.name],
  setup({ bodySize }, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(paragraph, () => (attrs, node) => ({
        kind: 'text',
        ...typography({ kind: 'paragraph' }, bodySize),
        baselineGrid: 4,
        text: attrs.text,
        spans: formattingSpans(node.marks),
        atoms: node.layoutInline(),
      })),
    );
    context.provide(
      presentations,
      defineNodePresentation(heading, () => (attrs, node) => {
        const spans = formattingSpans(node.marks);

        return {
          kind: 'text',
          ...typography({ kind: 'heading', level: attrs.level }, bodySize),
          font: { weight: 700 },
          baselineGrid: 4,
          text: attrs.text,
          spans,
          atoms: node.layoutInline(),
        };
      }),
    );
    context.provide(
      presentations,
      defineNodePresentation(image, () => () => ({
        kind: 'box',
        height: 96,
        before: 0,
        after: 24,
        baselineGrid: 4,
      })),
    );
    context.provide(
      presentations,
      defineNodePresentation(quote, () => () => ({
        kind: 'flow',
        child: (_index, inherited) => ({ ...inherited, inset: inherited.inset + 24 }),
      })),
    );
    context.provide(
      presentations,
      defineNodePresentation(list, () => () => ({
        kind: 'flow',
        child: (_index, inherited) => ({ ...inherited, inset: inherited.inset + 28 }),
      })),
    );
    context.provide(
      presentations,
      defineNodePresentation(listItem, () => () => ({
        kind: 'flow',
        child: (_index, inherited) => inherited,
      })),
    );

    return {};
  },
});
