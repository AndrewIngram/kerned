import type { NodeIdentity } from '@gprose/model';

import { allocatedBlockWidth } from '../browser/block-geometry.js';
import type { SlotInsets } from '../browser/content-slot.js';
import type { DrawingRect } from '../browser/drawing.js';

export type { SlotInsets } from '../browser/content-slot.js';

export const emptySlotInsets: SlotInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

export type FlowLayoutEvent<N> =
  | Readonly<{
      kind: 'open';
      at: number;
      to: number;
      node: N;
      inset: number;
      endInset: number;
      chrome: SlotInsets;
    }>
  | Readonly<{ kind: 'close'; at: number; id: number }>;

export type FlowPlacement<N> = Readonly<{
  node: N;
  bounds: DrawingRect;
  content: DrawingRect;
}>;

/** A single ordered walk reserves nested chrome around the leaf placement sequence. */
export function createFlowLayout<N extends NodeIdentity>(
  events: readonly FlowLayoutEvent<N>[],
  width: number,
) {
  const placements = new Map<number, FlowPlacement<N>>();
  const open = new Map<number, Extract<FlowLayoutEvent<N>, { kind: 'open' }>>();
  let cursor = 0;

  return {
    placements,
    boundary(at: number, y: number, gap: number) {
      let position = y;
      let spaced = false;

      while (cursor < events.length && events[cursor].at === at) {
        const event = events[cursor++];

        if (event.kind === 'open') {
          if (!spaced && event.at < event.to) {
            position += gap;
            spaced = true;
          }

          const allocated = allocatedBlockWidth(width, event.inset, event.endInset);
          placements.set(event.node.id, {
            node: event.node,
            bounds: { left: event.inset, top: position, width: allocated, height: 0 },
            content: {
              left: event.chrome.left,
              top: event.chrome.top,
              width: allocatedBlockWidth(allocated, event.chrome.left, event.chrome.right),
              height: 0,
            },
          });
          open.set(event.node.id, event);
          position += event.chrome.top;
        } else {
          const start = open.get(event.id);
          const placement = placements.get(event.id);

          if (!start || !placement) throw new Error('Unbalanced flow projection');
          const contentHeight = position - placement.bounds.top - placement.content.top;
          position += start.chrome.bottom;
          placements.set(event.id, {
            ...placement,
            bounds: { ...placement.bounds, height: position - placement.bounds.top },
            content: { ...placement.content, height: contentHeight },
          });
          open.delete(event.id);
        }
      }

      return spaced ? position : position + gap;
    },
  };
}
