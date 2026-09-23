import { defineExtension, type ContributionContext } from '@kerned/core';
import { indexTree, type NodeIdentity } from '@kerned/model';
import {
  decorations,
  defineWidgetView,
  type Decoration,
  type ViewSession,
  type DecorationSource,
} from '@kerned/view';

import type { PresenceSelection } from './protocol.js';

type PresenceSource = {
  remoteSelections(): { session: string; selection: PresenceSelection }[];
  subscribe(listener: () => void): () => void;
};

/** Presence is a view contribution; it never adds marks to synchronized content. */
export function remotePresence(
  source: PresenceSource,
  peer: { label: string; color: string; background: string },
) {
  const caret = defineWidgetView<string>((host) => {
    const label = document.createElement('span');
    const marker = document.createElement('div');
    marker.style.cssText = `pointer-events:none;border-left:2px solid ${peer.color};overflow:visible`;
    host.append(marker);
    label.style.cssText = `position:absolute;bottom:100%;left:-2px;padding:2px 5px;border-radius:3px 3px 3px 0;background:${peer.color};color:white;font:11px/16px system-ui;white-space:nowrap`;
    label.textContent = peer.label;
    marker.append(label);

    return {
      update({ anchor, data }) {
        marker.style.height = `${anchor.height}px`;
        host.dataset.remoteCaret = data;
      },
      destroy() {
        marker.remove();
      },
    };
  });

  return defineExtension({
    name: 'remotePresence',
    options: {},
    setup(_options, context: ContributionContext) {
      context.provide(decorations, {
        name: 'remotePresence',
        dependencies: 'document',
        create<N extends NodeIdentity>(editor: ViewSession<N>): DecorationSource<N> {
          return {
            subscribe: (listener) => source.subscribe(() => listener()),
            read(id, state) {
              const tree = indexTree(editor.schema, state.nodes);
              const node = tree.byId.get(id)?.node;

              if (!node || editor.getAccess(id) === 'protected') return [];
              const values: Decoration[] = [];

              for (const { session, selection } of source.remoteSelections()) {
                const anchor = tree.order.findIndex(
                  (item) => item.node.key === selection.anchor.key,
                );

                const head = tree.order.findIndex((item) => item.node.key === selection.head.key);
                const here = tree.order.findIndex((item) => item.node.id === id);

                if (anchor < 0 || head < 0) continue;

                const forward =
                  anchor < head ||
                  (anchor === head && selection.anchor.offset <= selection.head.offset);

                const start = forward ? selection.anchor : selection.head;
                const end = forward ? selection.head : selection.anchor;
                const text = editor.schema.text(node);

                if (
                  text !== null &&
                  here >= Math.min(anchor, head) &&
                  here <= Math.max(anchor, head)
                ) {
                  const from = node.key === start.key ? start.offset : 0;
                  const to = node.key === end.key ? end.offset : text.length;

                  if (from < to)
                    values.push({
                      kind: 'text',
                      key: `${session}:range`,
                      from,
                      to,
                      background: peer.background,
                      attributes: { 'data-remote-selection': session },
                    });
                }

                if (node.key === selection.head.key)
                  values.push(
                    caret({
                      key: `${session}:caret`,
                      at: { kind: 'text', offset: selection.head.offset },
                      data: session,
                    }),
                  );
              }

              return values;
            },
          };
        },
      });

      return {};
    },
  });
}

const protectedLabel = defineWidgetView<null>((host) => {
  const label = document.createElement('div');
  label.textContent = 'Protected content';
  label.dataset.protectedContent = '';
  label.style.cssText =
    'font:13px/24px system-ui;color:#85897e;background:#f4f5f0;border:1px dashed #dce0d4;border-radius:5px;padding:0 12px;white-space:nowrap;pointer-events:none';
  host.append(label);

  return {
    update() {},
    destroy() {
      label.remove();
    },
  };
});

export const protectedContent = defineExtension({
  name: 'protectedContent',
  options: {},
  setup(_options, context: ContributionContext) {
    context.provide(decorations, {
      name: 'protectedContent',
      create(editor) {
        return {
          read: (id) =>
            editor.getAccess(id) === 'protected'
              ? [
                  protectedLabel({
                    key: 'protected',
                    at: { kind: 'node', edge: 'start' },
                    data: null,
                  }),
                ]
              : [],
          subscribe: () => () => {},
        };
      },
    });

    return {};
  },
});
