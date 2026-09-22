import { type TextPoint, wordBoundary } from '@gprose/model';
import { TextSelection } from '@gprose/state';

type Direction = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

export type NavigationBlock = { id: number; text: string; top: number; height: number };

export type NavigationLayout = {
  lines: readonly {
    start: number;
    end: number;
    top: number;
    bottom: number;
    direction?: 'ltr' | 'rtl';
  }[];
  directionAt?(index: number, upstream: boolean): 'ltr' | 'rtl';
  hit(this: void, x: number, y: number): { index: number; upstream: boolean };
  geometry(anchor: number, focus: number, upstream: boolean): { caret: readonly number[] };
  move(
    index: number,
    upstream: boolean,
    direction: Direction,
  ): { index: number; upstream: boolean };
};

export type NavigationKey = {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

/** Renderer-independent keyboard navigation. Layouts may be hydrated on demand.
 * The controller retains a desired x for consecutive vertical/page movements.
 */
export function createTextNavigation() {
  let desiredX: number | undefined, previous: TextSelection | undefined;

  return {
    reset() {
      desiredX = undefined;
      previous = undefined;
    },
    move({
      event,
      selection,
      blocks,
      layout,
      viewportHeight,
      platform,
    }: {
      event: NavigationKey;
      selection: TextSelection;
      blocks: readonly NavigationBlock[];
      layout: (id: number) => NavigationLayout;
      viewportHeight: number;
      platform: 'mac' | 'other';
    }): TextSelection | null {
      const directions = new Map<string, Direction>([
        ['ArrowLeft', 'left'],
        ['ArrowRight', 'right'],
        ['ArrowUp', 'up'],
        ['ArrowDown', 'down'],
        ['Home', 'home'],
        ['End', 'end'],
      ]);

      const direction = directions.get(event.key),
        page = event.key === 'PageUp' || event.key === 'PageDown';

      if ((!direction && !page) || !blocks.length) return null;

      if (page && (event.altKey || event.ctrlKey || event.metaKey)) return null;

      if (
        (platform === 'mac' && event.ctrlKey && event.key.startsWith('Arrow')) ||
        (platform === 'other' && (event.altKey || event.metaKey))
      )
        return null;
      const at = blocks.findIndex((block) => block.id === selection.head.id);

      if (at < 0) return null;

      const block = blocks[at],
        back =
          event.key === 'PageUp' ||
          direction === 'left' ||
          direction === 'up' ||
          direction === 'home';

      if (!previous?.eq(selection)) desiredX = undefined;

      let head: TextPoint = { ...selection.head },
        upstream = false;

      const vertical = page || direction === 'up' || direction === 'down';

      const documentEdge =
        (event.ctrlKey && (direction === 'home' || direction === 'end')) ||
        (platform === 'mac' && event.metaKey && (direction === 'up' || direction === 'down'));

      const word = platform === 'mac' ? event.altKey : event.ctrlKey;

      if (documentEdge) {
        const target = back ? blocks[0] : blocks[blocks.length - 1];
        head = { id: target.id, offset: back ? 0 : target.text.length };
        desiredX = undefined;
      } else if (word && (direction === 'left' || direction === 'right')) {
        const runBack =
          back !== (layout(block.id).directionAt?.(head.offset, selection.upstream) === 'rtl');

        if (runBack && head.offset === 0 && at > 0)
          head = { id: blocks[at - 1].id, offset: blocks[at - 1].text.length };
        else if (!runBack && head.offset === block.text.length && at + 1 < blocks.length)
          head = { id: blocks[at + 1].id, offset: 0 };
        else head.offset = wordBoundary(block.text, head.offset, runBack, platform);
        desiredX = undefined;
      } else if (word && (direction === 'up' || direction === 'down')) {
        const index = back
          ? head.offset === 0
            ? Math.max(0, at - 1)
            : at
          : platform === 'mac' && head.offset < block.text.length
            ? at
            : Math.min(blocks.length - 1, at + 1);

        const target = blocks[index];
        head = { id: target.id, offset: back || platform === 'other' ? 0 : target.text.length };
        desiredX = undefined;
      }

      if (
        !documentEdge &&
        !(word && direction && ['left', 'right', 'up', 'down'].includes(direction))
      ) {
        if (
          !event.shiftKey &&
          (direction === 'left' || direction === 'right') &&
          !event.metaKey &&
          (selection.anchor.id !== selection.head.id ||
            selection.anchor.offset !== selection.head.offset)
        ) {
          const anchorAt = blocks.findIndex((b) => b.id === selection.anchor.id),
            forward = anchorAt < at || (anchorAt === at && selection.anchor.offset <= head.offset);

          let collapseBack = back !== (layout(block.id).lines[0]?.direction === 'rtl');

          if (anchorAt === at) {
            const current = layout(block.id);

            const anchorCaret = current.geometry(
              selection.anchor.offset,
              selection.anchor.offset,
              false,
            ).caret;

            const headCaret = current.geometry(
              selection.head.offset,
              selection.head.offset,
              selection.upstream,
            ).caret;

            if (anchorCaret[1] === headCaret[1]) {
              const anchorLeft = anchorCaret[0] <= headCaret[0];
              collapseBack = back ? anchorLeft === forward : anchorLeft !== forward;
            }
          }

          head = collapseBack
            ? forward
              ? selection.anchor
              : selection.head
            : forward
              ? selection.head
              : selection.anchor;
          desiredX = undefined;
        } else if (vertical) {
          const current = layout(block.id),
            caret = current.geometry(head.offset, head.offset, selection.upstream).caret;

          desiredX ??= caret[0];

          let target = block,
            y = 0,
            edge = false;

          if (page) {
            const documentY =
              block.top + (caret[1] + caret[3]) / 2 + (back ? -1 : 1) * viewportHeight;

            let distance = Infinity;

            for (const candidate of blocks) {
              const d = Math.max(
                candidate.top - documentY,
                0,
                documentY - candidate.top - candidate.height,
              );

              if (d < distance) {
                target = candidate;
                distance = d;
              }
            }

            y = documentY - target.top;
          } else {
            let line = current.lines.findIndex(
              (l) => (caret[1] + caret[3]) / 2 >= l.top && (caret[1] + caret[3]) / 2 <= l.bottom,
            );

            if (line < 0) line = 0;
            const next = current.lines[line + (back ? -1 : 1)];

            if (next) y = (next.top + next.bottom) / 2;
            else {
              const adjacent = blocks[at + (back ? -1 : 1)];

              if (!adjacent) {
                edge = true;
                head = { id: block.id, offset: back ? 0 : block.text.length };
              } else {
                target = adjacent;

                const lines = layout(target.id).lines,
                  lineValue = back ? lines.at(-1) : lines[0];

                y = lineValue ? (lineValue.top + lineValue.bottom) / 2 : 0;
              }
            }
          }

          if (!edge) {
            const hit = layout(target.id).hit(desiredX, y);
            head = { id: target.id, offset: hit.index };
            upstream = hit.upstream;
          }
        } else if (direction) {
          desiredX = undefined;
          const actual = platform === 'mac' && event.metaKey ? (back ? 'home' : 'end') : direction;
          const current = layout(block.id);
          const before = current.geometry(head.offset, head.offset, selection.upstream).caret;
          const hit = current.move(head.offset, selection.upstream, actual);
          const after = current.geometry(hit.index, hit.index, hit.upstream).caret;
          head = { id: block.id, offset: hit.index };
          upstream = hit.upstream;

          if (
            head.offset === selection.head.offset &&
            before[0] === after[0] &&
            before[1] === after[1] &&
            (actual === 'left' || actual === 'right')
          ) {
            const paragraphBack = back !== (layout(block.id).lines[0]?.direction === 'rtl');
            const target = blocks[at + (paragraphBack ? -1 : 1)];

            if (target) {
              head = { id: target.id, offset: paragraphBack ? target.text.length : 0 };
              upstream = false;
            }
          }
        }
      }

      const next = new TextSelection(event.shiftKey ? selection.anchor : head, head, upstream);
      previous = next;

      return next;
    },
  };
}
