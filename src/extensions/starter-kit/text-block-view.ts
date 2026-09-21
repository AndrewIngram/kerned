import type { RegisterCanvasPainter } from '../../editor-canvas/canvas-renderer';
import type { LaidOut, Rect } from '../../engines';
import type { TextBlockNode } from '../demo-model';

export type CommentHighlight = { id: string; from: number; to: number };

export type TextBlockFrame = {
  placement: { node: TextBlockNode; y: number; layout: LaidOut | null };
  comments: readonly CommentHighlight[];
  inset: number;
  open: (kind: 'comment', atomId: string, index: number) => void;
};

type Hit = { kind: 'comment'; id: string; index: number; label: string; rect: Rect };

/** Native DOM hits and canvas paint share the same immutable layout snapshot. */
export function createTextBlockView(element: HTMLDivElement, register: RegisterCanvasPainter) {
  const buttons = new Map<string, HTMLButtonElement>();
  let hits = new Map<string, Hit>();
  let frame: TextBlockFrame | undefined;
  let removePaint: (() => void)[] = [];
  let destroyed = false;

  function click(event: MouseEvent) {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const hit = hits.get(event.target.dataset.hit ?? '');

    if (hit && event.detail === 0) frame?.open(hit.kind, hit.id, hit.index);
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

      hits = new Map<string, Hit>();

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

        button.className = 'range-hit';
        button.setAttribute('aria-label', hit.label);

        button.dataset.editorTextHit = '';
        button.dataset.decoration = String(p.node.id);

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

      if (decorations.length)
        removePaint.push(
          register(
            `text-background-${p.node.id}`,
            (canvas, kit, paint) => {
              paint.setColor(kit.Color(246, 234, 180));

              for (const { rect: r } of decorations)
                canvas.drawRect(kit.XYWHRect(r[0], p.y + r[1], r[2] - r[0], r[3] - r[1]), paint);
            },
            'background',
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
