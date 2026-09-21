import { memo, type ComponentType } from 'react';

import {
  defineNodeView,
  type NodeViewAttributes,
  type NodeViewFrame,
} from '../editor-browser/node-views';
import type { NodeIdentity, SchemaDefinition } from '../model';
import { portalHostFor } from './portals';

type NodeDefinition = Extract<SchemaDefinition, { category: 'node' }>;

/** Canonical attributes are inferred from the registered definition, including defaults. */
export type ReactNodeViewProps<Definition extends NodeDefinition> = {
  readonly node: Readonly<NodeIdentity>;
  readonly attributes: NodeViewAttributes<Definition>;
  readonly width: number;
  readonly selected: boolean;
};

/** Register a measured React block with the same lifecycle as native node views. */
export function defineReactNodeView<Definition extends NodeDefinition>(
  definition: Definition,
  component: ComponentType<ReactNodeViewProps<Definition>>,
) {
  const Component = memo(component);

  return defineNodeView(definition, () => (element) => {
    const portals = portalHostFor(element);

    let current:
      | (NodeViewFrame<NodeIdentity> & { attributes: NodeViewAttributes<Definition> })
      | undefined;

    let selected = false;
    let destroyed = false;

    const observer = new ResizeObserver(() => {
      if (destroyed || !current) return;
      current.onMeasure(current.node.id, current.width, element.offsetHeight);
    });

    observer.observe(element);

    return {
      update(frame) {
        const nextSelected = frame.selection
          .ranges(frame.context)
          .some((range) => range.id === frame.node.id);

        const changed =
          !current ||
          current.node !== frame.node ||
          current.width !== frame.width ||
          selected !== nextSelected;

        current = frame;
        selected = nextSelected;

        if (!changed) return;
        portals.render(
          element,
          <Component
            node={frame.node}
            attributes={frame.attributes}
            width={frame.width}
            selected={selected}
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
