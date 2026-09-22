import type { NodeIdentity } from '@gprose/model';

import type { DrawingRect } from './drawing';
import type { RangeView, RangeViewMount, RangeViewContext } from './range-views';
import type { LayerBlock, ViewLayerContext, ViewLayerFrame } from './view-layers';

type Item<Frame> = { key: string; nodeId: number; bounds: DrawingRect; frame: Frame };

type Surface<Frame> = {
  item: Item<Frame>;
  overlay: HTMLDivElement | undefined;
  size: 'bounds' | 'content';
  active: boolean;
};

function place(overlay: HTMLElement, bounds: DrawingRect, size: 'bounds' | 'content') {
  overlay.style.left = `${bounds.left}px`;
  overlay.style.top = `${bounds.top}px`;
  overlay.style.width = size === 'content' ? 'max-content' : `${bounds.width}px`;
  overlay.style.height = size === 'content' ? 'auto' : `${bounds.height}px`;
}

export function createRangeViews<N extends NodeIdentity, Frame>(
  context: ViewLayerContext<N>,
  project: (block: LayerBlock<N>, color: string) => readonly Item<Frame>[],
  createRenderer: (context: RangeViewContext<N>) => (scope: RangeViewMount) => RangeView<Frame>,
  projectionCache: Pick<Map<NodeIdentity, unknown>, 'keys' | 'delete' | 'clear'>,
) {
  let dirty = false;
  let painted = false;

  const create = createRenderer({
    editor: context.editor,
    onDestroy: context.onDestroy,
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
    let drawable = false;

    for (const { view } of instances.values())
      if (view.draw) {
        drawable = true;
        break;
      }

    if (!drawable && !painted) return;
    painted = drawable;

    for (const layer of ['background', 'content'] as const)
      context.paint(
        layer,
        drawable
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
              size: 'bounds',
              active: true,
            };

            try {
              const view = create({
                createOverlay({ size = 'bounds' } = { size: 'bounds' }) {
                  if (!created.active) throw new Error('Range view is destroyed');

                  if (created.overlay && created.size !== size)
                    throw new Error('An overlay cannot change its sizing policy');

                  if (!created.overlay) {
                    created.size = size;
                    created.overlay = context.element.ownerDocument.createElement('div');
                    created.overlay.style.cssText = 'position:absolute;pointer-events:none;';
                    created.overlay.dataset.editorFocusNode = String(item.nodeId);
                    context.element.append(created.overlay);
                    place(created.overlay, created.item.bounds, created.size);
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

          if (instance.surface.overlay)
            place(instance.surface.overlay, item.bounds, instance.surface.size);

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
