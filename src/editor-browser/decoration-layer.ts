import type { NodeIdentity } from '../model';

import './decorations.css';
import { allocatedBlockBounds } from './block-geometry';
import {
  createDecorationSource,
  type Decoration,
  type DecorationContribution,
  type TextDecoration,
} from './decorations';
import type { DrawingRect, TextFragment } from './drawing';
import type { LayerBlock, ViewLayerContribution } from './view-layers';
import { createWidgetViews } from './widget-views';

function place(element: HTMLElement, rect: DrawingRect) {
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

/** One projection supplies canvas paint, accessible range controls and structural outlines. */
export function decorationLayer(provider: DecorationContribution): ViewLayerContribution {
  return {
    name: `decorations:${provider.name}`,
    create(context) {
      const { editor, element, paint, invalidate, listen, nodeAt, onTextPointer } = context;
      const controls = new Map<string, HTMLButtonElement>();
      const outlines = new Map<string, HTMLDivElement>();
      const active = new Map<number, readonly Decoration[]>();
      const hits = new Map<string, { nodeId: number; decoration: TextDecoration }>();

      const geometry = new Map<
        number,
        {
          text: LayerBlock<NodeIdentity>['text'];
          values: readonly Decoration[];
          ranges: readonly { decoration: TextDecoration; fragments: readonly TextFragment[] }[];
        }
      >();

      onTextPointer((event) => {
        if (event.kind !== 'start' || event.clicks !== 1) return;

        const decoration = active
          .get(event.point.id)
          ?.find(
            (value) =>
              value.kind !== 'widget' &&
              !!value.activation &&
              (value.kind === 'node' ||
                (event.point.offset >= value.from && event.point.offset <= value.to)),
          );

        if (!decoration || decoration.kind === 'widget') return;
        decoration.activation?.onActivate({
          nodeId: event.point.id,
          key: decoration.key,
          offset: decoration.kind === 'text' ? event.point.offset : 0,
          kind: decoration.kind === 'text' ? 'text' : 'control',
        });
      });
      listen('click', (event) => {
        if (event.detail !== 0 || !(event.target instanceof Element)) return;
        const button = event.target.closest<HTMLButtonElement>('[data-editor-decoration]');

        if (!button || !element.contains(button)) return;
        const hit = hits.get(button.dataset.editorDecoration ?? '');
        hit?.decoration.activation?.onActivate({
          nodeId: hit.nodeId,
          key: hit.decoration.key,
          offset: hit.decoration.from,
          kind: 'control',
        });
      });
      listen('pointerdown', (event) => {
        if (event.button !== 0 || event.defaultPrevented || !(event.target instanceof Element))
          return;

        if (event.target.closest('button,input,textarea,select,a,[data-editor-interactive]'))
          return;
        const node = nodeAt(event.target);

        const value =
          node && active.get(node.id)?.find((value) => value.kind === 'node' && value.activation);

        if (node && value?.kind === 'node')
          value.activation?.onActivate({
            nodeId: node.id,
            key: value.key,
            offset: 0,
            kind: 'control',
          });
      });

      const source = createDecorationSource(provider, editor, invalidate);
      const widgets = createWidgetViews(context, (id) => active.get(id) ?? []);

      return {
        update(frame) {
          const { blocks } = frame;
          source.begin();
          active.clear();
          hits.clear();
          const present = new Set<number>();
          const nextOutlines = new Set<string>();
          const rectangles: { rect: DrawingRect; color: string }[] = [];

          try {
            for (const block of blocks) {
              present.add(block.node.id);
              const values = source.read(block.node, editor.state);
              active.set(block.node.id, values);

              for (const value of values) {
                if (value.kind !== 'node') continue;
                const key = JSON.stringify([block.node.id, value.key]);
                nextOutlines.add(key);
                let outline = outlines.get(key);

                if (!outline) {
                  outline = element.ownerDocument.createElement('div');
                  outline.style.cssText = 'position:absolute;pointer-events:none;';
                  outline.setAttribute('aria-hidden', 'true');
                  element.append(outline);
                  outlines.set(key, outline);
                }

                place(outline, allocatedBlockBounds(block));
                outline.style.boxShadow = `0 0 0 ${value.outline.width}px ${value.outline.color}`;
                outline.style.borderRadius = `${value.outline.radius}px`;

                for (const name of outline.getAttributeNames())
                  if (name.startsWith('data-')) outline.removeAttribute(name);

                for (const [name, valueText] of Object.entries(value.attributes ?? {}))
                  outline.setAttribute(name, valueText);
              }

              if (!block.text) continue;
              let cached = geometry.get(block.node.id);

              if (!cached || cached.text !== block.text || cached.values !== values) {
                cached = {
                  text: block.text,
                  values,
                  ranges: values.flatMap((decoration) =>
                    decoration.kind === 'text'
                      ? [
                          {
                            decoration,
                            fragments: block.text?.fragments(decoration.from, decoration.to) ?? [],
                          },
                        ]
                      : [],
                  ),
                };
                geometry.set(block.node.id, cached);
              }

              for (const { decoration, fragments } of cached.ranges) {
                for (const [index, fragment] of fragments.entries()) {
                  const rect = {
                    left: block.left + fragment.left,
                    top: block.top + fragment.top,
                    width: fragment.width,
                    height: fragment.height,
                  };

                  rectangles.push({ rect, color: decoration.background });

                  if (!decoration.activation) continue;
                  const key = JSON.stringify([block.node.id, decoration.key, index]);
                  hits.set(key, { nodeId: block.node.id, decoration });
                  let button = controls.get(key);

                  if (!button) {
                    button = element.ownerDocument.createElement('button');
                    button.type = 'button';
                    button.className = 'editor-decoration-hit';
                    element.append(button);
                    controls.set(key, button);
                  }

                  for (const name of button.getAttributeNames())
                    if (name.startsWith('data-')) button.removeAttribute(name);

                  for (const [name, value] of Object.entries(
                    decoration.activation.attributes ?? {},
                  ))
                    button.setAttribute(name, value);
                  button.dataset.editorDecoration = key;
                  button.dataset.editorTextHit = '';
                  button.setAttribute('aria-label', decoration.activation.label);
                  place(button, rect);
                }
              }
            }
          } finally {
            source.end();
          }

          widgets.update(frame);

          for (const id of geometry.keys()) if (!present.has(id)) geometry.delete(id);

          for (const [key, control] of controls)
            if (!hits.has(key)) {
              control.remove();
              controls.delete(key);
            }

          for (const [key, outline] of outlines)
            if (!nextOutlines.has(key)) {
              outline.remove();
              outlines.delete(key);
            }

          paint(
            'background',
            rectangles.length
              ? (drawing) => {
                  for (const { rect, color } of rectangles) drawing.rect(rect, color);
                }
              : null,
          );
        },
        destroy() {
          const failures: unknown[] = [];

          try {
            source.destroy();
          } catch (error) {
            failures.push(error);
          }

          try {
            widgets.destroy();
          } catch (error) {
            failures.push(error);
          } finally {
            controls.clear();
            outlines.clear();
            active.clear();
            hits.clear();
            geometry.clear();
            element.replaceChildren();
          }

          if (failures.length)
            throw new AggregateError(failures, 'Decoration layer cleanup failed');
        },
      };
    },
  };
}
