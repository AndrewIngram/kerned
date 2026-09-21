import { defineExtension, type ContributionContext } from '../core';

import './search-view.css';
import {
  viewLayers,
  nativeTextDecorations,
  type DrawingRect,
  type TextDecoration,
} from '../editor-browser';

/** Search results are session state; the contribution paints only resident text. */
export const searchView = defineExtension({
  name: 'searchView',
  options: { color: '#ffec97', activeColor: '#f5b941' },
  setup(options, context: ContributionContext) {
    context.provide(nativeTextDecorations, {
      create(editor) {
        let current = editor.find.getSnapshot().state;
        const cache = new Map<number, readonly TextDecoration[]>();
        const empty: readonly TextDecoration[] = [];

        return {
          subscribe: editor.find.subscribe,
          read(id) {
            const state = editor.find.getSnapshot().state;

            if (state !== current) {
              cache.clear();
              current = state;
            }

            const matches = state.byNode.get(id);

            if (!matches) return empty;
            let value = cache.get(id);

            if (!value) {
              value = matches.map((match) => ({
                key: `${match.key}:${match.from}:${match.to}`,
                from: match.from,
                to: match.to,
                background: match === state.active ? options.activeColor : options.color,
                attributes: {
                  'data-find-match': 'true',
                  'data-find-active': String(match === state.active),
                },
              }));
              cache.set(id, value);
            }

            return value;
          },
        };
      },
    });
    context.provide(viewLayers, {
      name: 'search',
      create({ editor, invalidate, paint }) {
        const unsubscribe = editor.find.subscribe(invalidate);
        let painted = false;

        return {
          update({ blocks }) {
            const { state } = editor.find.getSnapshot();

            if (!state.matches.length && !painted) return;
            const ordinary: DrawingRect[] = [];
            const active: DrawingRect[] = [];

            for (const block of blocks) {
              if (!block.text) continue;

              for (const match of state.byNode.get(block.node.id) ?? []) {
                const rectangles = match === state.active ? active : ordinary;

                for (const fragment of block.text.fragments(match.from, match.to)) {
                  rectangles.push({
                    left: block.left + fragment.left,
                    top: block.top + fragment.top,
                    width: fragment.width,
                    height: fragment.height,
                  });
                }
              }
            }

            painted = !!(ordinary.length || active.length);
            paint(
              'background',
              painted
                ? (drawing) => {
                    for (const rect of ordinary) drawing.rect(rect, options.color);

                    for (const rect of active) drawing.rect(rect, options.activeColor);
                  }
                : null,
            );
          },
          destroy: unsubscribe,
        };
      },
    });

    return {};
  },
});
