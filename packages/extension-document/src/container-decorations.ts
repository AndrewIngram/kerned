import { defineExtension, type ContributionContext } from '@gprose/core';
import type { NodeIdentity, Schema } from '@gprose/model';
import { viewStyles } from '@gprose/view';
import { applyTextStyle } from '@gprose/view';
import { viewLayers, type ViewLayerFrame } from '@gprose/view';

import { containerStyles } from './container-decorations-styles.js';
import { quote, list, listItem } from './definitions.js';

function createContainerDecorations<N extends NodeIdentity>(
  element: HTMLDivElement,
  schema: Schema<N>,
) {
  element.setAttribute('aria-hidden', 'true');
  const quoteType = schema.node(quote);
  const listType = schema.node(list);
  const itemType = schema.node(listItem);
  const markers = new Map<number, HTMLDivElement>();
  const quotes = new Map<number, HTMLSpanElement>();

  return {
    update({ blocks, textStyle }: ViewLayerFrame<N>) {
      const active = new Set<number>();
      const rules = new Map<number, { top: number; bottom: number; left: number }>();

      for (const block of blocks) {
        let label = '';
        let inset = block.inset;

        for (const ancestor of block.ancestors) {
          const attrs = listType.read(ancestor.node);

          if (quoteType.matches(ancestor.node)) {
            const id = ancestor.node.id;
            const existing = rules.get(id);
            rules.set(id, {
              top: Math.min(existing?.top ?? block.top, block.top),
              bottom: Math.max(existing?.bottom ?? 0, block.top + block.height),
              left: block.left + ancestor.inset,
            });
            label = '';
          } else if (attrs) {
            label = attrs.ordered ? `${attrs.start + ancestor.childIndex}.` : '•';
          } else if (itemType.matches(ancestor.node)) {
            if (ancestor.childIndex > 0) label = '';
            inset = ancestor.inset;
          }
        }

        if (!label) continue;
        active.add(block.node.id);
        let marker = markers.get(block.node.id);

        if (!marker) {
          marker = element.ownerDocument.createElement('div');
          marker.className = 'block-decoration';
          marker.dataset.blockDecoration = String(block.node.id);
          const text = element.ownerDocument.createElement('span');
          text.className = 'list-marker';
          marker.append(text);
          markers.set(block.node.id, marker);
          element.append(marker);
        }

        const style = textStyle?.(block.node.id);

        if (style) applyTextStyle(marker, style);

        marker.style.left = `${block.left}px`;
        marker.style.top = `${block.top}px`;
        marker.style.width = `${inset}px`;
        marker.style.height = `${block.height}px`;

        if (marker.firstChild) marker.firstChild.textContent = label;
      }

      for (const [id, marker] of markers)
        if (!active.has(id)) {
          marker.remove();
          markers.delete(id);
        }

      for (const [id, rule] of rules) {
        let line = quotes.get(id);

        if (!line) {
          line = element.ownerDocument.createElement('span');
          line.className = 'quote-rule';
          line.dataset.quote = String(id);
          quotes.set(id, line);
          element.append(line);
        }

        line.style.left = `${rule.left}px`;
        line.style.top = `${rule.top}px`;
        line.style.height = `${rule.bottom - rule.top}px`;
      }

      for (const [id, line] of quotes)
        if (!rules.has(id)) {
          line.remove();
          quotes.delete(id);
        }
    },
    destroy() {
      markers.clear();
      quotes.clear();
      element.replaceChildren();
    },
  };
}

export const containerDecorations = defineExtension({
  name: 'containerDecorations',
  options: {},
  requires: [quote.name, list.name, listItem.name],
  setup(_options, context: ContributionContext) {
    context.provide(viewStyles, containerStyles);
    context.provide(viewLayers, {
      name: 'containers',
      create: ({ element, editor }) => createContainerDecorations(element, editor.schema),
    });

    return {};
  },
});
