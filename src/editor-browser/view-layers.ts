import { defineContribution } from '../core';
import type { NodeIdentity, TreeIndex } from '../model';
import type { ObserveTextPointer } from './canvas-input';
import type {
  BlockTextGeometry,
  DrawingLayer,
  DrawingPainter,
  LayerDrawing,
  PrepareText,
  InlineBounds,
} from './drawing';
import type { ViewSession } from './input-contributions';
import type { ReadTextStyle } from './text-style';

export type LayerBlock<N> = {
  readonly node: N;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly inset: number;
  readonly text: BlockTextGeometry | null;
  readonly inline: readonly InlineBounds[];
  readonly ancestors: readonly {
    readonly node: N;
    readonly childIndex: number;
    readonly inset: number;
  }[];
};

/** Bounds use unscaled document coordinates in the layer's positioned host. */
export type ViewLayerFrame<N> = {
  readonly blocks: readonly LayerBlock<N>[];
  readonly textStyle?: ReadTextStyle;
};

type ViewLayer<N> = {
  update(frame: ViewLayerFrame<N>): void;
  destroy(): void;
};

export type ViewLayerContext<N extends NodeIdentity> = {
  editor: ViewSession<N>;
  element: HTMLDivElement;
  prepareText: PrepareText;
  onTextPointer: ObserveTextPointer;
  /** Request this layer's next frame after an external source changes. */
  invalidate(this: void): void;
  /** Scoped to the editor overlay; listeners are released with the layer. */
  listen<K extends keyof HTMLElementEventMap>(
    this: void,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): () => void;
  nodeAt(this: void, target: EventTarget | null): N | null;
  /** One registration per plane, replaced on the next call and released with this layer. */
  paint: (layer: DrawingLayer, painter: DrawingPainter | null) => void;
};

export type ViewLayerContribution = {
  readonly name: string;
  create<N extends NodeIdentity>(context: ViewLayerContext<N>): ViewLayer<N>;
};

export const viewLayers = defineContribution<ViewLayerContribution>();

/** Install per-view overlays and translate private projection data once for all contributions. */
export function createViewLayers<N extends NodeIdentity>(
  element: HTMLElement,
  editor: ViewSession<N>,
  drawing: LayerDrawing,
  options: { onError?: (error: Error) => void; onTextPointer?: ObserveTextPointer } = {},
) {
  if (editor.isDestroyed) throw new Error('Editor is destroyed');
  const contributions = viewLayers.read(editor);
  const names = new Set<string>();

  for (const contribution of contributions) {
    if (names.has(contribution.name)) throw new Error(`Duplicate view layer: ${contribution.name}`);
    names.add(contribution.name);
  }

  const layers: {
    name: string;
    host: HTMLDivElement;
    view: ViewLayer<N>;
    releaseResources: () => void;
  }[] = [];

  const dirty = new Set<string>();
  let current: ViewLayerFrame<N> | undefined;
  let scheduled = 0;
  let destroyed = false;
  let tree: TreeIndex<N> | undefined;
  let insets: ReadonlyMap<number, { inset: number }> | undefined;
  const ancestors = new Map<number, LayerBlock<N>['ancestors']>();
  let detach: (() => void) | undefined;

  function flush() {
    scheduled = 0;

    if (destroyed || !current) return;

    try {
      for (const layer of layers) {
        if (destroyed) break;

        if (!dirty.delete(layer.name)) continue;
        layer.view.update(current);
      }
    } catch (error) {
      if (options.onError)
        options.onError(error instanceof Error ? error : new Error(String(error)));
      else throw error;
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(scheduled);
    scheduled = 0;
    dirty.clear();
    current = undefined;
    detach?.();
    const errors: unknown[] = [];

    for (const { host, view, releaseResources } of layers.splice(0).toReversed()) {
      try {
        view.destroy();
      } catch (error) {
        errors.push(error);
      }

      releaseResources();
      host.remove();
    }

    ancestors.clear();
    tree = undefined;
    insets = undefined;

    if (errors.length) throw new AggregateError(errors, 'View layer cleanup failed');
  }

  try {
    for (const contribution of contributions) {
      const host = element.ownerDocument.createElement('div');
      host.dataset.editorLayer = contribution.name;
      host.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      element.append(host);
      const painting = new Map<DrawingLayer, () => void>();
      const listeners = new Set<() => void>();
      const paintKey = `layer:${JSON.stringify(contribution.name)}`;
      let active = true;

      function releaseResources() {
        active = false;

        for (const release of listeners) release();
        listeners.clear();

        for (const release of painting.values()) release();
        painting.clear();
      }

      try {
        const view = contribution.create({
          editor,
          element: host,
          onTextPointer(listener) {
            if (!active || destroyed) throw new Error('View layer is destroyed');
            const stop = options.onTextPointer?.(listener);

            const release = () => {
              stop?.();
              listeners.delete(release);
            };

            listeners.add(release);

            return release;
          },
          invalidate() {
            if (!active || destroyed) return;
            dirty.add(contribution.name);

            if (current && !scheduled) scheduled = requestAnimationFrame(flush);
          },
          listen(type, listener) {
            if (!active || destroyed) throw new Error('View layer is destroyed');
            element.addEventListener(type, listener);

            const release = () => {
              element.removeEventListener(type, listener);
              listeners.delete(release);
            };

            listeners.add(release);

            return release;
          },
          nodeAt(target) {
            if (!active || destroyed || !(target instanceof Element) || !element.contains(target))
              return null;
            const id = target.closest('[data-editor-node]')?.getAttribute('data-editor-node');

            return id == null
              ? null
              : (current?.blocks.find((block) => block.node.id === Number(id))?.node ?? null);
          },
          prepareText(input) {
            if (!active || destroyed) throw new Error('View layer is destroyed');

            return drawing.prepareText(input);
          },
          paint(layer, painter) {
            if (!active || destroyed) throw new Error('View layer is destroyed');
            painting.get(layer)?.();
            painting.delete(layer);

            if (painter)
              painting.set(layer, drawing.register(`${paintKey}:${layer}`, layer, painter));
          },
        });

        layers.push({ name: contribution.name, host, view, releaseResources });
      } catch (error) {
        releaseResources();
        host.remove();
        throw error;
      }

      if (editor.isDestroyed) throw new Error('Editor was destroyed while creating a view layer');
    }

    detach = editor.on('destroy', destroy);
  } catch (error) {
    try {
      destroy();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'View layer initialization failed', {
        cause: cleanupError,
      });
    }

    throw error;
  }

  return {
    update(frame: {
      tree: TreeIndex<N>;
      textStyle?: ReadTextStyle;
      insets: ReadonlyMap<number, { inset: number }>;
      blocks: readonly {
        node: N;
        y: number;
        height: number;
        text: BlockTextGeometry | null;
        inline: readonly InlineBounds[];
      }[];
      inset: number;
      width: number;
    }) {
      if (destroyed) throw new Error('View layers are destroyed');

      if (!layers.length) return;

      if (tree !== frame.tree || insets !== frame.insets) {
        ancestors.clear();
        tree = frame.tree;
        insets = frame.insets;
      }

      const blocks = frame.blocks.map((block): LayerBlock<N> => {
        let path = ancestors.get(block.node.id);

        if (!path) {
          const values: { node: N; childIndex: number; inset: number }[] = [];
          let child = frame.tree.byId.get(block.node.id);

          while (child && child.parent !== null) {
            const parent = frame.tree.byId.get(child.parent);
            const inherited = frame.insets.get(child.parent);

            if (!parent || !inherited) break;
            values.push({ node: parent.node, childIndex: child.index, inset: inherited.inset });
            child = parent;
          }

          path = values.toReversed();
          ancestors.set(block.node.id, path);
        }

        return {
          node: block.node,
          left: frame.inset,
          top: block.y,
          width: frame.width,
          height: block.height,
          inset: frame.insets.get(block.node.id)?.inset ?? 0,
          text: block.text,
          inline: block.inline,
          ancestors: path,
        };
      });

      current = { blocks, textStyle: frame.textStyle };

      for (const { name, view } of layers) {
        dirty.delete(name);
        view.update(current);
      }

      if (!dirty.size && scheduled) {
        cancelAnimationFrame(scheduled);
        scheduled = 0;
      }
    },
    destroy,
  };
}
