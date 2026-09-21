import type { RegisterCanvasPainter } from '../../editor-canvas/canvas-renderer';
import type { TextLabels } from '../../editor-canvas/text-labels';
import type { LaidOut, Rect } from '../../engines';
import type { createOwnedEngine } from '../../owned-layout';
import type { TextBlockNode } from '../demo-model';

type Owned = Awaited<ReturnType<typeof createOwnedEngine>>;

type InlineBox = Pick<
  ReturnType<ReturnType<Owned['createLayout']>['layoutInline']>['inlineBoxes'][number],
  'id' | 'index' | 'label' | 'x' | 'y' | 'width' | 'height'
>;

export type CommentHighlight = { id: string; from: number; to: number };

export type TextBlockFrame = {
  placement: { node: TextBlockNode; y: number; layout: LaidOut | null; boxes: InlineBox[] };
  comments: readonly CommentHighlight[];
  inset: number;
  open: (kind: 'mention' | 'comment', atomId: string, index: number) => void;
};

type Hit = { kind: 'mention' | 'comment'; id: string; index: number; label: string; rect: Rect };

/** Native DOM hits and canvas paint share the same immutable layout snapshot. */
export function createTextBlockView(
  element: HTMLDivElement,
  register: RegisterCanvasPainter,
  labels: TextLabels,
) {
  const buttons = new Map<string, HTMLButtonElement>();
  let hits = new Map<string, Hit>();
  let frame: TextBlockFrame | undefined;
  let removePaint: (() => void)[] = [];
  let destroyed = false;

  function click(event: MouseEvent) {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const hit = hits.get(event.target.dataset.hit ?? '');

    if (hit && (hit.kind === 'mention' || event.detail === 0))
      frame?.open(hit.kind, hit.id, hit.index);
  }

  element.addEventListener('click', click);

  return {
    update(next: TextBlockFrame) {
      if (destroyed) throw new Error('Text block view is destroyed');
      const previous = frame;
      frame = next;
      const { placement: p, comments, inset } = next;

      if (
        previous &&
        previous.placement.node === p.node &&
        previous.placement.layout === p.layout &&
        previous.placement.y === p.y &&
        previous.placement.boxes === p.boxes &&
        previous.comments === comments &&
        previous.inset === inset
      )
        return;

      const decorations = comments.flatMap(
        (comment) =>
          p.layout
            ?.geometry(comment.from, comment.to, false)
            .rects.map((rect) => ({ comment, rect })) ?? [],
      );

      const underlines = p.node.marks
        .filter((span) => span.mark.type === 'underline')
        .flatMap(
          (span) =>
            p.layout?.geometry(span.from, span.to, false).rects.map((rect) => ({
              rect,
              baseline:
                p.layout?.lines.find((line) => line.top <= rect[1] && line.bottom > rect[1])
                  ?.baseline ?? rect[3] - 6,
            })) ?? [],
        );

      const mentions = p.boxes.map((box) => ({
        box,
        label: labels({ text: box.label, width: box.width - 12, size: 18 }),
      }));

      hits = new Map<string, Hit>();

      for (const { box } of mentions)
        hits.set(`mention:${box.id}`, {
          kind: 'mention',
          id: box.id,
          index: box.index,
          label: `Open ${box.label}`,
          rect: [box.x, box.y, box.x + box.width, box.y + box.height],
        });

      for (const [index, { comment, rect }] of decorations.entries())
        hits.set(`comment:${comment.id}:${index}`, {
          kind: 'comment',
          id: comment.id,
          index: comment.from,
          label: 'Open comment on highlighted text',
          rect,
        });

      for (const [key, hit] of hits) {
        let button = buttons.get(key);

        if (!button) {
          button = element.ownerDocument.createElement('button');
          button.type = 'button';
          button.dataset.hit = key;
          buttons.set(key, button);
          element.append(button);
        }

        button.className = hit.kind === 'mention' ? 'mention-hit' : 'range-hit';
        button.setAttribute('aria-label', hit.label);

        if (hit.kind === 'mention') button.dataset.mention = hit.id;
        else {
          button.dataset.editorTextHit = '';
          button.dataset.decoration = String(p.node.id);
        }

        const r = hit.rect;
        button.style.left = `${inset + r[0]}px`;
        button.style.top = `${p.y + r[1]}px`;
        button.style.width = `${r[2] - r[0]}px`;
        button.style.height = `${r[3] - r[1]}px`;
      }

      for (const [key, button] of buttons)
        if (!hits.has(key)) {
          button.remove();
          buttons.delete(key);
        }

      for (const remove of removePaint) remove();
      removePaint = [];

      if (decorations.length || mentions.length)
        removePaint.push(
          register(
            `text-background-${p.node.id}`,
            (canvas, kit, paint) => {
              paint.setColor(kit.Color(246, 234, 180));

              for (const { rect: r } of decorations)
                canvas.drawRect(kit.XYWHRect(r[0], p.y + r[1], r[2] - r[0], r[3] - r[1]), paint);
              paint.setColor(kit.Color(229, 237, 218));

              for (const { box } of mentions)
                canvas.drawRRect(
                  kit.RRectXY(kit.XYWHRect(box.x, p.y + box.y, box.width, box.height), 4, 4),
                  paint,
                );
            },
            'background',
          ),
        );

      if (underlines.length || mentions.length)
        removePaint.push(
          register(
            `text-content-${p.node.id}`,
            (canvas, kit, paint) => {
              paint.setColor(kit.Color(41, 50, 39));

              for (const { rect: r, baseline } of underlines)
                canvas.drawRect(kit.XYWHRect(r[0], p.y + baseline + 2, r[2] - r[0], 1), paint);

              for (const { box, label } of mentions)
                label.draw(canvas, box.x + 6, p.y + box.y + (box.height - label.height) / 2);
            },
            'content',
          ),
        );
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      element.removeEventListener('click', click);

      for (const remove of removePaint) remove();
      removePaint = [];
      frame = undefined;
      hits.clear();
      buttons.clear();
      element.replaceChildren();
    },
  };
}
