import type { NodeIdentity } from '../model';
import type { DrawingRect } from './drawing';
import type { RangeView, RangeViewMount, RangeViewContext } from './range-views';
import type { LayerBlock, ViewLayerContext, ViewLayerFrame } from './view-layers';

type Item<Frame> = { key: string; nodeId: number; bounds: DrawingRect; frame: Frame };

type Surface<Frame> = {
  item: Item<Frame>;
  overlay: HTMLDivElement | undefined;
  active: boolean;
};

function place(overlay: HTMLElement, bounds: DrawingRect) {
  overlay.style.left = `${bounds.left}px`;
  overlay.style.top = `${bounds.top}px`;
  overlay.style.width = `${bounds.width}px`;
  overlay.style.height = `${bounds.height}px`;
}

export function createRangeViews<N extends NodeIdentity, Frame>(
  context: ViewLayerContext<N>,
  project: (block: LayerBlock<N>, color: string) => readonly Item<Frame>[],
  createRenderer: (context: RangeViewContext<N>) => (scope: RangeViewMount) => RangeView<Frame>,
  projectionCache: Pick<Map<NodeIdentity, unknown>, 'keys' | 'delete' | 'clear'>,
) {
  let dirty = false;

  const create = createRenderer({
    editor: context.editor,
    prepareText: context.prepareText,
    invalidate() {
      dirty = true;
      context.invalidate();
    },
  });

  const instances = new Map<
    string,
    {
      surface: Surface<Frame>;
      view: RangeView<Frame>;
    }
  >();

  function release(key: string) {
    const instance = instances.get(key);

    if (!instance) return;
    instances.delete(key);
    instance.surface.active = false;

    try {
      instance.view.destroy();
    } finally {
      instance.surface.overlay?.remove();
    }
  }

  function paint() {
    for (const layer of ['background', 'content'] as const)
      context.paint(
        layer,
        instances.size
          ? (drawing) => {
              for (const { surface, view } of instances.values()) {
                if (!view.draw) continue;
                const { left, top } = surface.item.bounds;
                view.draw(
                  {
                    rect: (rect, color, radius) =>
                      drawing.rect(
                        { ...rect, left: left + rect.left, top: top + rect.top },
                        color,
                        radius,
                      ),
                    text: (label, x, y) => drawing.text(label, left + x, top + y),
                  },
                  layer,
                );
              }
            }
          : null,
      );
  }

  return {
    update({ blocks, textStyle }: ViewLayerFrame<N>) {
      const retained = new Set<string>();
      const resident = new Set<NodeIdentity>();
      const force = dirty;
      dirty = false;

      for (const block of blocks) {
        resident.add(block.node);
        const color = textStyle?.(block.node.id)?.color ?? '#293227';

        for (const item of project(block, color)) {
          if (retained.has(item.key)) throw new Error(`Duplicate rendered range: ${item.key}`);
          retained.add(item.key);
          let instance = instances.get(item.key);
          const previous = instance?.surface.item.frame;

          if (!instance) {
            const created: Surface<Frame> = {
              item,
              overlay: undefined,
              active: true,
            };

            try {
              const view = create({
                createOverlay() {
                  if (!created.active) throw new Error('Range view is destroyed');

                  if (!created.overlay) {
                    created.overlay = context.element.ownerDocument.createElement('div');
                    created.overlay.style.cssText = 'position:absolute;pointer-events:none;';
                    created.overlay.dataset.editorFocusNode = String(item.nodeId);
                    context.element.append(created.overlay);
                    place(created.overlay, created.item.bounds);
                  }

                  return created.overlay;
                },
              });

              instance = { surface: created, view };
              instances.set(item.key, instance);
            } catch (error) {
              created.active = false;
              created.overlay?.remove();
              throw error;
            }
          }

          instance.surface.item = item;

          if (instance.surface.overlay) place(instance.surface.overlay, item.bounds);

          if (force || previous !== item.frame) instance.view.update(item.frame);
        }
      }

      const failures: unknown[] = [];

      for (const node of projectionCache.keys())
        if (!resident.has(node)) projectionCache.delete(node);

      for (const key of instances.keys()) {
        if (retained.has(key)) continue;

        try {
          release(key);
        } catch (error) {
          failures.push(error);
        }
      }

      if (failures.length) throw new AggregateError(failures, 'Range view cleanup failed');
      paint();
    },
    destroy() {
      const failures: unknown[] = [];
      projectionCache.clear();

      for (const key of instances.keys()) {
        try {
          release(key);
        } catch (error) {
          failures.push(error);
        }
      }

      if (failures.length) throw new AggregateError(failures, 'Range view cleanup failed');
    },
  };
}
