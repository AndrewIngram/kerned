import { defineContribution, defineExtension, type ExtensionContext } from '../core';
import {
  viewLayers,
  nativeTextDecorations,
  type TextDecoration,
  type ViewLayerContext,
  type ViewLayerFrame,
  type DrawingRect,
} from '../editor-browser';
import type { NodeIdentity } from '../model';
import { createCommentProjection, type CommentSource } from './comment-projection';

import './comment-view.css';

export type CommentActivation = Readonly<{
  nodeId: number;
  id: string;
  index: number;
  focus: 'text' | 'panel';
}>;

type Listener = (comment: CommentActivation) => void;

const activations = defineContribution<{ subscribe(listener: Listener): () => void }>();

export function onCommentActivate(
  editor: Parameters<typeof activations.read>[0],
  listener: Listener,
) {
  const channels = activations.read(editor);

  if (channels.length !== 1) throw new Error('Install commentView to observe comments');

  return channels[0].subscribe(listener);
}

function createCommentLayer<N extends NodeIdentity>(
  { editor, element, paint, invalidate, listen, nodeAt, onTextPointer }: ViewLayerContext<N>,
  source: CommentSource,
  color: string,
  activate: Listener,
) {
  const project = createCommentProjection(editor, source);
  const buttons = new Map<string, HTMLButtonElement>();
  const outlines = new Map<number, HTMLDivElement>();
  let hits = new Map<string, Omit<CommentActivation, 'focus'>>();
  let current = project();
  const unsubscribe = source.subscribe(invalidate);
  onTextPointer((event) => {
    if (event.kind !== 'start' || event.clicks !== 1) return;

    const comment = current.text
      .get(event.point.id)
      ?.find((range) => event.point.offset >= range.from && event.point.offset <= range.to);

    if (comment)
      activate({
        nodeId: event.point.id,
        id: comment.id,
        index: event.point.offset,
        focus: 'text',
      });
  });
  listen('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-comment-hit]');

    if (button && element.contains(button)) {
      const hit = hits.get(button.dataset.commentHit ?? '');

      if (!hit || event.detail !== 0) return;
      activate({ ...hit, focus: 'panel' });

      return;
    }
  });
  listen('pointerdown', (event) => {
    if (event.button !== 0 || event.defaultPrevented || !(event.target instanceof Element)) return;

    if (event.target.closest('button,input,textarea,select,a,[data-editor-interactive]')) return;
    const node = nodeAt(event.target);
    const id = node && current.nodes.get(node.id)?.[0];

    if (node && id) activate({ nodeId: node.id, id, index: 0, focus: 'panel' });
  });

  return {
    update({ blocks }: ViewLayerFrame<N>) {
      current = project();

      if (!current.text.size && !current.nodes.size && !buttons.size && !outlines.size) return;
      const nextHits = new Map<string, Omit<CommentActivation, 'focus'>>();
      const nextNodes = new Set<number>();
      const rectangles: DrawingRect[] = [];

      for (const block of blocks) {
        if (!block.text && current.nodes.has(block.node.id)) {
          nextNodes.add(block.node.id);
          let outline = outlines.get(block.node.id);

          if (!outline) {
            outline = element.ownerDocument.createElement('div');
            outline.className = 'comment-node-outline';
            outline.dataset.commentedNode = String(block.node.id);
            outline.setAttribute('aria-hidden', 'true');
            element.append(outline);
            outlines.set(block.node.id, outline);
          }

          outline.style.left = `${block.left}px`;
          outline.style.top = `${block.top}px`;
          outline.style.width = `${block.width}px`;
          outline.style.height = `${block.height}px`;
        }

        if (!block.text) continue;

        for (const comment of current.text.get(block.node.id) ?? []) {
          for (const [index, fragment] of block.text
            .fragments(comment.from, comment.to)
            .entries()) {
            const key = `${block.node.id}:${comment.id}:${index}`;

            const rect = {
              left: block.left + fragment.left,
              top: block.top + fragment.top,
              width: fragment.width,
              height: fragment.height,
            };

            rectangles.push(rect);
            nextHits.set(key, { nodeId: block.node.id, id: comment.id, index: comment.from });
            let button = buttons.get(key);

            if (!button) {
              button = element.ownerDocument.createElement('button');
              button.type = 'button';
              button.className = 'range-hit';
              button.dataset.commentHit = key;
              button.dataset.editorTextHit = '';
              button.dataset.decoration = String(block.node.id);
              button.setAttribute('aria-label', 'Open comment on highlighted text');
              element.append(button);
              buttons.set(key, button);
            }

            button.style.left = `${rect.left}px`;
            button.style.top = `${rect.top}px`;
            button.style.width = `${rect.width}px`;
            button.style.height = `${rect.height}px`;
          }
        }
      }

      for (const [key, button] of buttons)
        if (!nextHits.has(key)) {
          button.remove();
          buttons.delete(key);
        }

      for (const [id, outline] of outlines)
        if (!nextNodes.has(id)) {
          outline.remove();
          outlines.delete(id);
        }

      hits = nextHits;
      paint(
        'background',
        rectangles.length
          ? (drawing) => {
              for (const rect of rectangles) drawing.rect(rect, color);
            }
          : null,
      );
    },
    destroy() {
      unsubscribe();
      buttons.clear();
      outlines.clear();
      hits.clear();
      element.replaceChildren();
    },
  };
}

/** Source injection is distinct from serializable visual options. The caller owns persistence. */
export function commentView(source: CommentSource) {
  return defineExtension({
    name: 'commentView',
    options: { color: '#f6eab4' },
    setup(options, context: Pick<ExtensionContext<NodeIdentity>, 'provide' | 'onDestroy'>) {
      context.provide(nativeTextDecorations, {
        create(editor) {
          const project = createCommentProjection(editor, source);
          let current = project();
          const cache = new Map<number, readonly TextDecoration[]>();
          const empty: readonly TextDecoration[] = [];

          return {
            subscribe: (listener) => source.subscribe(listener),
            read(id) {
              const projection = project();

              if (projection !== current) {
                current = projection;
                cache.clear();
              }

              const comments = projection.text.get(id);

              if (!comments) return empty;
              let value = cache.get(id);

              if (!value) {
                value = comments.map((comment) => ({
                  key: `comment:${comment.id}`,
                  from: comment.from,
                  to: comment.to,
                  background: options.color,
                  attributes: { 'data-comment-range': comment.id },
                }));
                cache.set(id, value);
              }

              return value;
            },
          };
        },
      });
      const listeners = new Set<Listener>();
      context.onDestroy(() => listeners.clear());
      context.provide(activations, {
        subscribe(listener) {
          listeners.add(listener);

          return () => {
            listeners.delete(listener);
          };
        },
      });
      context.provide(viewLayers, {
        name: 'comments',
        create: (view) =>
          createCommentLayer(view, source, options.color, (value) => {
            const pending = [...listeners];

            for (const listener of pending) listener(value);
          }),
      });

      return {};
    },
  });
}
