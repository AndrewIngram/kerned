import type { BlockPresentation, PresentBlock } from '../../editor-canvas/scene';
import type { StarterLeaf } from '../demo-model';
import { formattingSpans } from '../formatting';
import { inlineSchema } from '../mention';
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
