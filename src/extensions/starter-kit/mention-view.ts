import { defineContribution, defineExtension, type ExtensionContext } from '@gprose/core';
import type { NodeIdentity } from '@gprose/model';
import {
  viewLayers,
  defineInlineView,
  type InlineViewFrame,
  type PreparedText,
} from '@gprose/view';

import { mentionDefinition } from '../starter-definitions';

import './mention-view.css';

export type MentionActivation = Readonly<{ nodeId: number; id: string; index: number }>;

type Listener = (mention: MentionActivation) => void;

const activations = defineContribution<{ subscribe: (listener: Listener) => () => void }>();

/** Observe this session's mention activation from either native or React hosts. */
export function onMentionActivate(
  editor: Parameters<typeof activations.read>[0],
  listener: Listener,
) {
  const channels = activations.read(editor);

  if (channels.length !== 1) throw new Error('Install mentionView to observe mentions');

  return channels[0].subscribe(listener);
}

export const mentionView = defineExtension({
  name: 'mentionView',
  requires: [mentionDefinition.name],
  options: { background: '#e5edda', size: 18, padding: 6, radius: 4 },
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

    function activate(mention: MentionActivation) {
      const current = [...listeners];

      for (const listener of current) listener(mention);
    }

    context.provide(
      viewLayers,
      defineInlineView(mentionDefinition, ({ prepareText }) => ({ createOverlay }) => {
        const host = createOverlay();
        const button = host.ownerDocument.createElement('button');
        button.type = 'button';
        button.className = 'mention-hit';
        button.style.cssText = 'inset:0;width:100%;height:100%;';
        host.append(button);
        let current: InlineViewFrame<typeof mentionDefinition> | undefined;
        let label: PreparedText | undefined;

        function click() {
          if (current) activate({ nodeId: current.node.id, id: current.id, index: current.index });
        }

        button.addEventListener('click', click);

        return {
          update(frame) {
            current = frame;
            button.dataset.mention = frame.id;
            button.dataset.editorNode = String(frame.node.id);
            button.setAttribute('aria-label', `Open ${frame.attributes.label}`);
            label = prepareText({
              text: frame.attributes.label,
              width: Math.max(1, frame.width - options.padding * 2),
              size: options.size,
            });
          },
          draw(drawing, layer) {
            if (!current || !label) return;

            if (layer === 'background')
              drawing.rect(
                {
                  left: 0,
                  top: 0,
                  width: current.width,
                  height: current.height,
                },
                options.background,
                options.radius,
              );
            else drawing.text(label, options.padding, (current.height - label.height) / 2);
          },
          destroy() {
            button.removeEventListener('click', click);
            current = undefined;
            label = undefined;
          },
        };
      }),
    );

    return {};
  },
});
