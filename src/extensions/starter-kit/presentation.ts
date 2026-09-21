import { defineExtension, type ContributionContext } from '../../core';
import { defineNodePresentation, presentations } from '../../editor-canvas/presentation';
import type { BlockPresentation, PresentBlock } from '../../editor-canvas/scene';
import type { NodeIdentity, Schema } from '../../model';
import type { StarterLeaf } from '../demo-model';
import { formattingSpans } from '../formatting';
import { inlineSchema } from '../mention';
import { paragraph, heading, image, table, quote, list, listItem } from '../starter-definitions';
import { tableRows } from '../table';
import { typography } from '../typography';

/** Starter-kit appearance, independent of the scene's placement and retention algorithms. */
export function createStarterPresentation(size: number): PresentBlock<StarterLeaf> {
  const cache = new WeakMap<StarterLeaf, BlockPresentation>();

  return (node) => {
    const cached = cache.get(node);

    if (cached) return cached;
    let value: BlockPresentation;

    if (node.kind === 'paragraph' || node.kind === 'heading') {
      const style = typography(node, size);
      const spans = formattingSpans(node.marks);

      if (node.kind === 'heading' && node.text.length)
        spans.push({ start: 0, end: node.text.length, bold: true, italic: false });
      value = {
        kind: 'text',
        ...style,
        baselineGrid: 4,
        text: node.text,
        spans,
        atoms: node.inline.map(inlineSchema.layout),
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
        atoms: node.inline.map(inlineSchema.layout),
      })),
    );
    context.provide(
      presentations,
      defineNodePresentation(heading, () => (attrs, node) => {
        const spans = formattingSpans(node.marks);

        if (attrs.text.length)
          spans.push({ start: 0, end: attrs.text.length, bold: true, italic: false });

        return {
          kind: 'text',
          ...typography({ kind: 'heading', level: attrs.level }, bodySize),
          baselineGrid: 4,
          text: attrs.text,
          spans,
          atoms: node.inline.map(inlineSchema.layout),
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
