import { defineContribution, defineExtension, type ExtensionContext } from '../../core';
import {
  viewLayers,
  type ViewLayerContext,
  type ViewLayerFrame,
  type PreparedText,
  type DrawingRect,
} from '../../editor-browser';
import type { NodeIdentity } from '../../model';
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

function createMentionView<N extends NodeIdentity>(
  { editor, element, paint, prepareText }: ViewLayerContext<N>,
  options: { background: string; size: number; padding: number; radius: number },
  activate: Listener,
) {
  const buttons = new Map<string, HTMLButtonElement>();
  let hits = new Map<string, MentionActivation>();
  let labels = new Map<N, ReadonlyMap<string, string>>();

  function click(event: MouseEvent) {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const hit = hits.get(event.target.dataset.mentionKey ?? '');

    if (hit) activate(hit);
  }

  element.addEventListener('click', click);

  return {
    update({ blocks }: ViewLayerFrame<N>) {
      if (!hits.size && blocks.every((block) => !block.inline.length)) {
        labels.clear();

        return;
      }

      const retained = new Map<N, ReadonlyMap<string, string>>();
      const nextHits = new Map<string, MentionActivation>();
      const drawing: { bounds: DrawingRect; label: PreparedText }[] = [];

      for (const block of blocks) {
        if (!block.inline.length) continue;
        let names = labels.get(block.node);

        if (!names) {
          const type = editor.schema.resolve(block.node);

          if (type.kind !== 'text') continue;
          names = new Map(
            (type.editing.inline?.read(block.node) ?? [])
              .filter((value) => value.type === mentionDefinition.name)
              .map((value) => [
                value.id,
                mentionDefinition.spec.attributes.parse(value.attrs).label,
              ]),
          );
        }

        retained.set(block.node, names);

        for (const box of block.inline) {
          const name = names.get(box.id);

          if (name === undefined) continue;
          const key = `${block.node.id}:${box.id}`;

          const bounds = {
            left: block.left + box.left,
            top: block.top + box.top,
            width: box.width,
            height: box.height,
          };

          const label = prepareText({
            text: name,
            width: Math.max(1, box.width - options.padding * 2),
            size: options.size,
          });

          drawing.push({ bounds, label });
          nextHits.set(key, { nodeId: block.node.id, id: box.id, index: box.index });
          let button = buttons.get(key);

          if (!button) {
            button = element.ownerDocument.createElement('button');
            button.type = 'button';
            button.className = 'mention-hit';
            button.dataset.mentionKey = key;
            button.dataset.mention = box.id;
            button.dataset.editorNode = String(block.node.id);
            element.append(button);
            buttons.set(key, button);
          }

          button.setAttribute('aria-label', `Open ${name}`);
          button.style.left = `${bounds.left}px`;
          button.style.top = `${bounds.top}px`;
          button.style.width = `${bounds.width}px`;
          button.style.height = `${bounds.height}px`;
        }
      }

      for (const [key, button] of buttons)
        if (!nextHits.has(key)) {
          button.remove();
          buttons.delete(key);
        }

      hits = nextHits;
      labels = retained;
      paint(
        'background',
        drawing.length
          ? (context) => {
              for (const { bounds } of drawing)
                context.rect(bounds, options.background, options.radius);
            }
          : null,
      );
      paint(
        'content',
        drawing.length
          ? (context) => {
              for (const { bounds, label } of drawing)
                context.text(
                  label,
                  bounds.left + options.padding,
                  bounds.top + (bounds.height - label.height) / 2,
                );
            }
          : null,
      );
    },
    destroy() {
      element.removeEventListener('click', click);
      buttons.clear();
      hits.clear();
      labels.clear();
      element.replaceChildren();
    },
  };
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
    context.provide(viewLayers, {
      name: 'mentions',
      create: (view) =>
        createMentionView(view, options, (mention) => {
          // A callback can subscribe or unsubscribe while activation is being delivered.
          const current = [...listeners];

          for (const listener of current) listener(mention);
        }),
    });

    return {};
  },
});
