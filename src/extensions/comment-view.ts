import { defineContribution, defineExtension, type ExtensionContext } from '@gprose/core';
import type { NodeIdentity } from '@gprose/model';
import {
  decorations,
  type Decoration,
  type DecorationSource,
  type ViewSession,
  type DecorationActivation,
} from '@gprose/view';

import { createCommentProjection, type CommentSource } from './comment-projection';

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

/** The feature owns thread data and durable ranges; the view owns decoration projection. */
export function commentView(source: CommentSource) {
  return defineExtension({
    name: 'commentView',
    options: { color: '#f6eab4' },
    setup(options, context: Pick<ExtensionContext<NodeIdentity>, 'provide' | 'onDestroy'>) {
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

      function activate(event: DecorationActivation) {
        const value: CommentActivation = {
          nodeId: event.nodeId,
          id: event.key,
          index: event.offset,
          focus: event.kind === 'text' ? 'text' : 'panel',
        };

        const pending = [...listeners];

        for (const listener of pending) listener(value);
      }

      context.provide(decorations, {
        name: 'comments',
        create<N extends NodeIdentity>(editor: ViewSession<N>): DecorationSource<N> {
          const project = createCommentProjection(editor, source);
          let current = project();
          const cache = new Map<number, readonly Decoration[]>();
          const empty: readonly Decoration[] = [];

          return {
            subscribe: (listener) => source.subscribe(listener),
            read(id, state) {
              const projection = project(state.nodes);

              if (projection !== current) {
                current = projection;
                cache.clear();
              }

              if (!projection.text.has(id) && !projection.nodes.has(id)) return empty;
              let value = cache.get(id);

              if (!value) {
                value = [
                  ...(projection.text.get(id) ?? []).map((comment): Decoration => ({
                    kind: 'text',
                    key: comment.id,
                    from: comment.from,
                    to: comment.to,
                    background: options.color,
                    attributes: { 'data-comment-range': comment.id },
                    activation: {
                      label: 'Open comment on highlighted text',
                      attributes: { 'data-comment-hit': comment.id, 'data-decoration': String(id) },
                      onActivate: activate,
                    },
                  })),
                  ...(projection.nodes.get(id) ?? []).slice(0, 1).map((key): Decoration => ({
                    kind: 'node',
                    key,
                    outline: { color: '#e9cb7880', width: 3, radius: 8 },
                    attributes: { 'data-commented-node': String(id) },
                    activation: { onActivate: activate },
                  })),
                ];
                cache.set(id, value);
              }

              return value;
            },
          };
        },
      });

      return {};
    },
  });
}
