import { defineWidgetView, type WidgetViewFrame } from '@gprose/view';
import { memo, type ComponentType } from 'react';

import { portalHostFor } from './portals.js';

export type ReactWidgetViewProps<Data> = WidgetViewFrame<Data>;

/** Returns typed decoration descriptors rendered inside the editor's React context. */
export function defineReactWidgetView<Data>(
  component: ComponentType<ReactWidgetViewProps<Data>>,
): ReturnType<typeof defineWidgetView<Data>> {
  const Component = memo(component);

  return defineWidgetView<Data>((element) => {
    const portals = portalHostFor(element);

    return {
      update(frame) {
        portals.render(element, <Component {...frame} />);
      },
      destroy() {
        portals.remove(element);
      },
    };
  });
}
