import { defineContribution } from '../core';
import type { NodeIdentity, TreeIndex } from '../model';
import type {
  BlockTextGeometry,
  DrawingLayer,
  DrawingPainter,
  LayerDrawing,
  PrepareText,
  InlineBounds,
} from './drawing';
import type { ViewSession } from './input-contributions';

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
export type ViewLayerFrame<N> = { readonly blocks: readonly LayerBlock<N>[] };

type ViewLayer<N> = {
  update(frame: ViewLayerFrame<N>): void;
  destroy(): void;
};

export type ViewLayerContext<N extends NodeIdentity> = {
  editor: ViewSession<N>;
  element: HTMLDivElement;
  prepareText: PrepareText;
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
) {
  if (editor.isDestroyed) throw new Error('Editor is destroyed');
  const contributions = viewLayers.read(editor);
  const names = new Set<string>();

  for (const contribution of contributions) {
    if (names.has(contribution.name)) throw new Error(`Duplicate view layer: ${contribution.name}`);
    names.add(contribution.name);
  }

  const layers: { host: HTMLDivElement; view: ViewLayer<N>; releasePaint: () => void }[] = [];
  let destroyed = false;
  let tree: TreeIndex<N> | undefined;
  let insets: ReadonlyMap<number, { inset: number }> | undefined;
  const ancestors = new Map<number, LayerBlock<N>['ancestors']>();
  let detach: (() => void) | undefined;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    detach?.();
    const errors: unknown[] = [];

    for (const { host, view, releasePaint } of layers.splice(0).toReversed()) {
      try {
        view.destroy();
      } catch (error) {
        errors.push(error);
      }

      releasePaint();
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
      const paintKey = `layer:${JSON.stringify(contribution.name)}`;
      let active = true;

      function releasePaint() {
        active = false;

        for (const release of painting.values()) release();
        painting.clear();
      }

      try {
        const view = contribution.create({
          editor,
          element: host,
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

        layers.push({ host, view, releasePaint });
      } catch (error) {
        releasePaint();
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

      for (const { view } of layers) view.update({ blocks });
    },
    destroy,
  };
}
