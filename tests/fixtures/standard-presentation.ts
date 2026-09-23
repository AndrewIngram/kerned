import { formattingSpans, mentionLayout } from '@kerned/extension-document';
import { typography } from '@kerned/extension-document/browser';
import type { BlockPresentation } from '@kerned/view';

import type { StarterLeaf } from '../../apps/demo/src/demo-model.js';

export function createFixturePresentation(size: number): (node: StarterLeaf) => BlockPresentation {
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
