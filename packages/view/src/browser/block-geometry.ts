import type { DrawingRect } from './drawing.js';

/** Shared allocation for text, native blocks, measurements and node decorations. */
export function allocatedBlockWidth(width: number, inset: number, endInset = 0) {
  return Math.max(0, width - inset - endInset);
}

/** Layer text coordinates include the inherited inset; node chrome starts after it. */
export function allocatedBlockBounds(
  block: DrawingRect & { readonly inset: number; readonly endInset?: number },
): DrawingRect {
  return {
    left: block.left + block.inset,
    top: block.top,
    width: allocatedBlockWidth(block.width, block.inset, block.endInset),
    height: block.height,
  };
}
