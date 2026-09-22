import { defineExtension, type ContributionContext } from '@gprose/core';
import { formattingSpans } from '@gprose/extension-document';
import { mentionLayout } from '@gprose/extension-document';
import { paragraph, heading, image, quote, list, listItem } from '@gprose/extension-document';
import { table } from '@gprose/extension-table';
import { tableRows } from '@gprose/extension-table';
import type { NodeIdentity, Schema } from '@gprose/model';
import { defineNodePresentation, presentations } from '@gprose/view';
import type { BlockPresentation } from '@gprose/view';

import type { StarterLeaf } from '../demo-model';
import { typography } from '../typography';

/** Starter-kit appearance, independent of the scene's placement and retention algorithms. */
export function createStarterPresentation(size: number): (node: StarterLeaf) => BlockPresentation {
  const cache = new WeakMap<StarterLeaf, BlockPresentation>();

  return (node) => {
    const cached = cache.get(node);

    if (cached) return cached;
    let value: BlockPresentation;

    if (node.kind === 'paragraph' || node.kind === 'heading') {
      const style = typography(node, size);
      const spans = formattingSpans(node.marks);

      value = {
        kind: 'text',
        ...style,
        font: node.kind === 'heading' ? { weight: 700 } : undefined,
        baselineGrid: 4,
        text: node.text,
        spans,
        atoms: node.inline.map(mentionLayout),
      };
    } else {
      value = {
        kind: 'box',
        before: 0,
        after: 24,
        baselineGrid: 4,
        height: node.kind === 'image' ? 96 : Math.max(60, node.rows.length * 64),
      };
    }

    cache.set(node, value);

    return value;
  };
}

/** Browser defaults are contributed alongside the installed schema; mounts discover them. */
export const starterPresentation = defineExtension({
  name: 'starterPresentation',
  options: { bodySize: 18 },
  requires: [
    paragraph.name,
    heading.name,
    image.name,
    table.name,
    quote.name,
    list.name,
    listItem.name,
  ],
  setup({ bodySize }, context: ContributionContext) {
    context.provide(
      presentations,
      defineNodePresentation(paragraph, () => (attrs, node) => ({
        kind: 'text',
        ...typography({ kind: 'paragraph' }, bodySize),
        baselineGrid: 4,
        text: attrs.text,
        spans: formattingSpans(node.marks),
        atoms: node.inline.map(mentionLayout),
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
          atoms: node.inline.map(mentionLayout),
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
    context.provide(presentations, {
      create<N extends NodeIdentity>(schema: Schema<N>) {
        const binding = schema.node(table);

        return {
          name: table.name,
          read(node: N): BlockPresentation {
            if (!binding.matches(node)) throw new Error('Expected table presentation');

            return {
              kind: 'box',
              height: Math.max(60, tableRows(schema, node).length * 64),
              before: 0,
              after: 24,
              baselineGrid: 4,
            };
          },
        };
      },
    });
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
