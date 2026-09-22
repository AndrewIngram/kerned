import type { SchemaDefinition } from '@gprose/model';
import { equalScopedSelection } from '@gprose/state';
import { memo, type ComponentType } from 'react';

import { defineNodeView, type NodeRenderFrame } from '../editor-browser/node-views';
import { portalHostFor } from './portals';

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

/** Canonical attributes are inferred from the registered definition, including defaults. */
export type ReactNodeViewProps<Definition extends NodeDefinition> = Readonly<
  Pick<
    NodeRenderFrame<Definition>,
    'node' | 'attributes' | 'width' | 'selection' | 'access' | 'content'
  >
>;

/** Register a measured React block with the same lifecycle as native node views. */
export function defineReactNodeView<Definition extends NodeDefinition>(
  definition: Definition,
  component: ComponentType<ReactNodeViewProps<Definition>>,
) {
  const Component = memo(component);

  return defineNodeView(definition, () => (element) => {
    const portals = portalHostFor(element);

    let current: NodeRenderFrame<Definition> | undefined;

    let destroyed = false;

    const observer = new ResizeObserver(() => {
      if (destroyed || !current || current.content) return;
      current.onMeasure(current.node.id, current.width, element.offsetHeight);
    });

    observer.observe(element);

    return {
      update(frame) {
        const changed =
          !current ||
          current.node !== frame.node ||
          current.width !== frame.width ||
          current.content !== frame.content ||
          current.access !== frame.access ||
          !equalScopedSelection(current.selection, frame.selection);

        current = frame;

        if (!changed) return;
        portals.render(
          element,
          <Component
            node={frame.node}
            content={frame.content}
            attributes={frame.attributes}
            width={frame.width}
            selection={frame.selection}
            access={frame.access}
          />,
        );
      },
      destroy() {
        destroyed = true;
        current = undefined;
        observer.disconnect();
        portals.remove(element);
      },
    };
  });
}
