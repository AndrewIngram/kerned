import type { NodeIdentity } from '@kerned/model';
import { equalScopedSelection, type ScopedSelection, type NodeAccess } from '@kerned/state';

import { allocatedBlockWidth } from './block-geometry.js';
import type { Decoration } from './decorations.js';
import type { DrawingRect } from './drawing.js';
import { createRangeViews } from './range-view-owner.js';
import type { LayerBlock, ViewLayerContext } from './view-layers.js';

export type WidgetAnchor =
  | Readonly<{ kind: 'text'; offset: number; upstream?: boolean }>
  | Readonly<{ kind: 'node'; edge: 'start' | 'end' }>;

export type WidgetViewFrame<Data> = Readonly<{
  node: Readonly<NodeIdentity>;
  access: NodeAccess;
  selection: ScopedSelection;
  data: Data;
  at: WidgetAnchor;
  /** The anchor rectangle is block-local; the mount positions the DOM host. */
  anchor: DrawingRect;
}>;

export type WidgetView<Data> = {
  update(frame: WidgetViewFrame<Data>): void;
  destroy(): void;
};

const widgetRenderer = Symbol('widgetRenderer');

/** Created by defineWidgetView; a view instruction, never serialized document content. */
export type WidgetDecoration = Readonly<{
  kind: 'widget';
  key: string;
  at: WidgetAnchor;
  [widgetRenderer]: {
    owner: { destroy(element: HTMLElement): void };
    render(
      element: HTMLElement,
      node: NodeIdentity,
      anchor: DrawingRect,
      access: NodeAccess,
      selection: ScopedSelection,
    ): void;
  };
}>;

/** Typed data stays inside the renderer closure, without casts or schema registration. */
export function defineWidgetView<Data>(create: (element: HTMLElement) => WidgetView<Data>) {
  const instances = new WeakMap<HTMLElement, WidgetView<Data>>();

  const owner = {
    destroy(element: HTMLElement) {
      const view = instances.get(element);
      instances.delete(element);
      view?.destroy();
    },
  };

  return ({
    key,
    at,
    data,
  }: Readonly<{ key: string; at: WidgetAnchor; data: Data }>): WidgetDecoration => {
    if (at.kind === 'text' && (!Number.isSafeInteger(at.offset) || at.offset < 0))
      throw new Error('Widget text offsets must be nonnegative safe integers');

    return {
      kind: 'widget',
      key,
      at,
      [widgetRenderer]: {
        owner,
        render(element, node, anchor, access, selection) {
          let view = instances.get(element);

          if (!view) {
            view = create(element);
            instances.set(element, view);
          }

          view.update({ node, data, at, anchor, access, selection });
        },
      },
    };
  };
}

type ProjectedWidget = {
  node: NodeIdentity;
  access: NodeAccess;
  selection: ScopedSelection;
  decoration: WidgetDecoration;
  anchor: DrawingRect;
};

/** Decoration sources share the range owner's placement, focus pinning and culling. */
export function createWidgetViews<N extends NodeIdentity>(
  context: ViewLayerContext<N>,
  read: (nodeId: number) => readonly Decoration[],
) {
  const rendererIds = new WeakMap<object, number>();
  let nextRendererId = 0;

  function key(node: NodeIdentity, decoration: WidgetDecoration) {
    const { owner } = decoration[widgetRenderer];
    let id = rendererIds.get(owner);

    if (id === undefined) {
      id = nextRendererId++;
      rendererIds.set(owner, id);
    }

    return JSON.stringify([node.id, decoration.key, id]);
  }

  const cache = new Map<
    NodeIdentity,
    {
      text: LayerBlock<N>['text'];
      width: number;
      height: number;
      inset: number;
      endInset: number | undefined;
      access: NodeAccess;
      selection: ScopedSelection;
      values: readonly Decoration[];
      frames: readonly ProjectedWidget[];
    }
  >();

  return createRangeViews(
    context,
    (block) => {
      const values = read(block.node.id);

      if (!values.some((value) => value.kind === 'widget')) {
        cache.delete(block.node);

        return [];
      }

      const access = context.editor.getAccess(block.node.id);
      const selection = context.editor.getSelection(block.node.id);

      if (!access || !selection)
        throw new Error('Cannot render a node outside the current document');
      let previous = cache.get(block.node);

      if (
        !previous ||
        previous.values !== values ||
        previous.text !== block.text ||
        previous.width !== block.width ||
        previous.height !== block.height ||
        previous.inset !== block.inset ||
        previous.endInset !== block.endInset ||
        previous.access !== access ||
        !equalScopedSelection(previous.selection, selection)
      ) {
        const frames: ProjectedWidget[] = [];

        for (const decoration of values) {
          if (decoration.kind !== 'widget') continue;
          const { at } = decoration;

          const anchor =
            at.kind === 'text'
              ? block.text?.caret(at.offset, at.upstream)
              : {
                  left: block.inset,
                  top: at.edge === 'start' ? 0 : block.height,
                  width: allocatedBlockWidth(block.width, block.inset, block.endInset),
                  height: 0,
                };

          if (anchor) frames.push({ node: block.node, decoration, anchor, access, selection });
        }

        previous = {
          text: block.text,
          width: block.width,
          height: block.height,
          inset: block.inset,
          endInset: block.endInset,
          values,
          frames,
          access,
          selection,
        };
        cache.set(block.node, previous);
      }

      return previous.frames.map((frame) => ({
        key: key(block.node, frame.decoration),
        nodeId: block.node.id,
        bounds: {
          ...frame.anchor,
          left: block.left + frame.anchor.left,
          top: block.top + frame.anchor.top,
        },
        frame,
      }));
    },
    () =>
      ({ createOverlay }) => {
        const element = createOverlay({ size: 'content' });
        let current: WidgetDecoration[typeof widgetRenderer] | undefined;

        function destroy() {
          const previous = current;
          current = undefined;
          previous?.owner.destroy(element);
        }

        return {
          update({ node, decoration, anchor, access, selection }) {
            const next = decoration[widgetRenderer];

            current = next;
            current.render(element, node, anchor, access, selection);
          },
          destroy,
        };
      },
    cache,
  );
}
