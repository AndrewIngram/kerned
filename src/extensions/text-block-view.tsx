import type { CanvasKit } from 'canvaskit-wasm';
import { useMemo } from 'react';

import type { TextLabels } from '../editor-canvas/text-labels';
import {
  CanvasPrimitive,
  createReactRenderers,
  type CanvasPainter as Painter,
} from '../editor-react';
import type { LaidOut } from '../engines';
import type { createOwnedEngine } from '../owned-layout';
import type { StarterNode } from './demo-model';

type Owned = Awaited<ReturnType<typeof createOwnedEngine>>;

type InlineBox = Pick<
  ReturnType<ReturnType<Owned['createLayout']>['layoutInline']>['inlineBoxes'][number],
  'id' | 'index' | 'label' | 'x' | 'y' | 'width' | 'height'
>;

type TextPlacement = { node: StarterNode; y: number; layout: LaidOut | null; boxes: InlineBox[] };

export type CommentHighlight = { id: string; from: number; to: number };

const noComments: readonly CommentHighlight[] = [];

export function ParagraphExtensions({
  placement: p,
  comments = noComments,
  kit,
  labels,
  open,
}: {
  placement: TextPlacement;
  comments?: readonly CommentHighlight[];
  kit: CanvasKit;
  labels: TextLabels;
  open: (kind: 'mention' | 'comment', atomId: string, index: number) => void;
}) {
  const node = p.node;

  const decorations = useMemo(
    () =>
      (node.kind === 'paragraph' || node.kind === 'heading') && p.layout
        ? comments.flatMap(
            (c) =>
              p.layout?.geometry(c.from, c.to, false).rects.map((rect) => ({ comment: c, rect })) ??
              [],
          )
        : [],
    [p.layout, node, comments],
  );

  const underlines = useMemo(
    () =>
      (node.kind === 'paragraph' || node.kind === 'heading') && p.layout
        ? node.marks
            .filter((s) => s.mark.type === 'underline')
            .flatMap(
              (s) =>
                p.layout?.geometry(s.from, s.to, false).rects.map((rect) => ({
                  rect,
                  baseline:
                    p.layout?.lines.find((line) => line.top <= rect[1] && line.bottom > rect[1])
                      ?.baseline ?? rect[3] - 6,
                })) ?? [],
            )
        : [],
    [p.layout, node],
  );

  const commentValue = useMemo(
    () => ({ id: node.id, y: p.y, decorations, open }),
    [node.id, p.y, decorations, open],
  );

  const markValue = useMemo(
    () => ({ id: node.id, y: p.y, underlines }),
    [node.id, p.y, underlines],
  );

  const mentions = useMemo(
    () =>
      p.boxes.map((box) => ({
        box,
        y: p.y,
        kit,
        labels,
        onOpen: () => open('mention', box.id, box.index),
      })),
    [p.boxes, p.y, kit, labels, open],
  );

  return (
    <>
      <DecorationView type="comment" value={commentValue} />
      <MarkView type="underline" value={markValue} />
      {mentions.map((value) => (
        <InlineView key={value.box.id} type="mention" value={value} />
      ))}
    </>
  );
}

function Mention({
  box,
  y,
  labels,
  onOpen,
}: {
  box: InlineBox;
  y: number;
  kit: CanvasKit;
  labels: TextLabels;
  onOpen: () => void;
}) {
  const label = useMemo(
    () =>
      labels({
        text: box.label,
        width: box.width - 12,
        size: 18,
      }),
    [labels, box.label, box.width],
  );

  const background = useMemo<Painter>(
    () => (canvas, kit, paint) => {
      paint.setColor(kit.Color(229, 237, 218));
      canvas.drawRRect(
        kit.RRectXY(kit.XYWHRect(box.x, y + box.y, box.width, box.height), 4, 4),
        paint,
      );
    },
    [box.x, box.y, box.width, box.height, y],
  );

  const labelPainter = useMemo<Painter>(
    () => (canvas) => label.draw(canvas, box.x + 6, y + box.y + (box.height - label.height) / 2),
    [label, box.x, box.y, box.height, y],
  );

  return (
    <>
      <CanvasPrimitive id={`mention-background-${box.id}`} paint={background} layer="background" />
      <CanvasPrimitive id={`mention-${box.id}`} paint={labelPainter} />
      <button
        className="mention-hit"
        data-mention={box.id}
        aria-label={`Open ${box.label}`}
        style={{ left: 28 + box.x, top: y + box.y, width: box.width, height: box.height }}
        onClick={onOpen}
      />
    </>
  );
}

type CommentViewProps = {
  id: number;
  y: number;
  decorations: { comment: CommentHighlight; rect: number[] }[];
  open: (kind: 'mention' | 'comment', id: string, index: number) => void;
};

const DecorationView = createReactRenderers<CommentViewProps>([
  {
    name: 'comment',
    component: ({ value }) => {
      const { id, y, decorations, open } = value;

      const paint = useMemo<Painter>(
        () => (canvas, k, brush) => {
          brush.setColor(k.Color(246, 234, 180));

          for (const { rect: r } of decorations)
            canvas.drawRect(k.XYWHRect(r[0], y + r[1], r[2] - r[0], r[3] - r[1]), brush);
        },
        [decorations, y],
      );

      return (
        <>
          <CanvasPrimitive id={`decoration-${id}`} paint={paint} layer="background" />
          {decorations.map(({ rect: r, comment }) => (
            <button
              key={`${comment.id}:${r.join(',')}`}
              className="range-hit"
              data-editor-text-hit
              data-decoration={id}
              aria-label="Open comment on highlighted text"
              style={{ left: 28 + r[0], top: y + r[1], width: r[2] - r[0], height: r[3] - r[1] }}
              onClick={(event) => {
                if (event.detail === 0) open('comment', comment.id, comment.from);
              }}
            />
          ))}
        </>
      );
    },
  },
]);

const MarkView = createReactRenderers<{
  id: number;
  y: number;
  underlines: { rect: number[]; baseline: number }[];
}>([
  {
    name: 'underline',
    component: ({ value: { id, y, underlines } }) => {
      const paint = useMemo<Painter>(
        () => (canvas, k, brush) => {
          brush.setColor(k.Color(41, 50, 39));

          for (const { rect: r, baseline } of underlines)
            canvas.drawRect(k.XYWHRect(r[0], y + baseline + 2, r[2] - r[0], 1), brush);
        },
        [underlines, y],
      );

      return <CanvasPrimitive id={`underline-${id}`} paint={paint} />;
    },
  },
]);

const InlineView = createReactRenderers<Parameters<typeof Mention>[0]>([
  { name: 'mention', component: ({ value }) => <Mention {...value} /> },
]);
