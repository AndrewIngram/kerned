import { defineExtension, type ContributionContext } from '@gprose/core';

import './search-view.css';
import { decorations, type TextDecoration } from '../editor-browser';

/** Search results are session state; the contribution paints only resident text. */
export const searchView = defineExtension({
  name: 'searchView',
  options: { color: '#ffec97', activeColor: '#f5b941' },
  setup(options, context: ContributionContext) {
    context.provide(decorations, {
      name: 'search',
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
                kind: 'text',
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

    return {};
  },
});
