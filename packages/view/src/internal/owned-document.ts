import type { Geometry, Rect } from './engines.js';
import type { Direction, Position } from './layout-types.js';
import type { ComposedParagraph } from './owned-paragraph.js';

type Placement = { offset: number; y: number; paragraph: ComposedParagraph };

function preceding(values: Placement[], target: number, key: 'offset' | 'y') {
  let low = 0,
    high = values.length;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if (values[middle][key] <= target) low = middle + 1;
    else high = middle;
  }

  return Math.max(0, low - 1);
}

export function placeParagraphs(paragraphs: ComposedParagraph[]) {
  let offset = 0,
    height = 0;

  let overflowAbove = 0,
    overflowBelow = 0;

  const placements = paragraphs.map((paragraph) => {
    const placement = { offset, y: height, paragraph };
    overflowAbove = Math.max(overflowAbove, -paragraph.inkTop);
    overflowBelow = Math.max(overflowBelow, paragraph.inkBottom - paragraph.height);
    offset += paragraph.textLength + 1;
    height += paragraph.height;

    return placement;
  });

  // Line metadata uses document coordinates for navigation and hit testing.
  // Glyph buffers and caret indexes remain local and shared.
  const lines = placements.flatMap((p) =>
    p.paragraph.lines.map((line) => ({
      ...line,
      start: line.start + p.offset,
      end: line.end + p.offset,
      top: line.top + p.y,
      bottom: line.bottom + p.y,
      baseline: line.baseline + p.y,
    })),
  );

  function hit(x: number, y: number): Position {
    const p = placements[preceding(placements, y, 'y')];

    return documentPosition(p, p.paragraph.hit(x, y - p.y));
  }

  function geometry(anchor: number, focus: number, upstream: boolean): Geometry {
    const p = placements[preceding(placements, focus, 'offset')];

    const caret = translated(
      p.paragraph.geometry(focus - p.offset, focus - p.offset, upstream).caret,
      p.y,
    );

    const rects: Rect[] = [];

    if (anchor !== focus) {
      const low = Math.min(anchor, focus),
        high = Math.max(anchor, focus);

      const first = preceding(placements, low, 'offset'),
        last = preceding(placements, high, 'offset');

      for (let i = first; i <= last; i++) {
        const pValue = placements[i];

        const start = Math.max(0, low - pValue.offset),
          end = Math.min(pValue.paragraph.textLength, high - pValue.offset);

        for (const rect of pValue.paragraph.geometry(start, end, false).rects)
          rects.push(translated(rect, pValue.y));
      }
    }

    return { caret, rects };
  }

  return {
    placements,
    height,
    lines,
    hit,
    geometry,
    directionAt(this: void, index: number, upstream: boolean) {
      const p = placements[preceding(placements, index, 'offset')];

      return p.paragraph.directionAt(index - p.offset, upstream);
    },
    *visible(top: number, bottom: number) {
      if (!(bottom > top)) return;

      for (let i = preceding(placements, top - overflowBelow, 'y'); i < placements.length; i++) {
        const placement = placements[i];

        if (placement.y >= bottom + overflowAbove) break;

        if (
          placement.y + placement.paragraph.inkBottom > top &&
          placement.y + placement.paragraph.inkTop < bottom
        )
          yield placement;
      }
    },
    move(this: void, index: number, upstream: boolean, direction: Direction): Position {
      const ordinal = preceding(placements, index, 'offset'),
        p = placements[ordinal];

      const local = index - p.offset;

      if (direction === 'up' || direction === 'down') {
        const caret = geometry(index, index, upstream).caret;
        const lineHeight = caret[3] - caret[1];

        return hit(
          caret[0],
          (caret[1] + caret[3]) / 2 + (direction === 'up' ? -lineHeight : lineHeight),
        );
      }

      const rtl = p.paragraph.lines[0]?.direction === 'rtl';
      const backward = direction === (rtl ? 'right' : 'left');
      const horizontal = direction === 'left' || direction === 'right';
      const moved = p.paragraph.move(local, upstream, direction);
      const before = p.paragraph.geometry(local, local, upstream).caret;
      const after = p.paragraph.geometry(moved.index, moved.index, moved.upstream).caret;
      const stalled = moved.index === local && before[0] === after[0] && before[1] === after[1];

      if (horizontal && backward && stalled && ordinal > 0) {
        const previous = placements[ordinal - 1];

        return { index: previous.offset + previous.paragraph.textLength, upstream: false };
      }

      if (horizontal && !backward && stalled && ordinal + 1 < placements.length) {
        return { index: placements[ordinal + 1].offset, upstream: false };
      }

      return documentPosition(p, moved);
    },
  };
}

function documentPosition(p: Placement, position: Position): Position {
  return { index: position.index + p.offset, upstream: position.upstream };
}

function translated(rect: Rect, y: number): Rect {
  return [rect[0], rect[1] + y, rect[2], rect[3] + y];
}
