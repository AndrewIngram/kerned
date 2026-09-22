import type { Mark } from './marks.js';
import type { NodeIdentity, Schema } from './schema.js';

/** Left-side formatting wins at a boundary; document start uses the right side. */
export function marksAt<N extends NodeIdentity>(
  schema: Schema<N>,
  node: N,
  offset: number,
  side: 'left' | 'right' = 'left',
): Mark[] {
  const extension = schema.resolve(node),
    adapter = extension.kind === 'text' ? extension.editing.marks : undefined;

  const marks: Mark[] = [];

  for (const range of adapter?.read(node) ?? []) {
    const included =
      side === 'right'
        ? range.from <= offset && range.to > offset
        : (range.from < offset && range.to > offset) ||
          (range.from === offset && (adapter?.boundary?.(range.mark, 'start') ?? offset === 0)) ||
          (range.to === offset && (adapter?.boundary?.(range.mark, 'end') ?? true));

    if (included && !marks.some((mark) => mark.type === range.mark.type)) marks.push(range.mark);
  }

  return marks;
}
