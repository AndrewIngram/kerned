import { memo, type ComponentType } from 'react';

import {
  defineInlineView,
  defineMarkView,
  type InlineViewFrame,
  type MarkViewFrame,
  type RangeView,
  type RangeViewMount,
} from '../editor-browser';
import type { SchemaDefinition } from '../model';
import { portalHostFor } from './portals';

type InlineDefinition = Extract<SchemaDefinition, { category: 'inline' }>;

type MarkDefinition = Extract<SchemaDefinition, { category: 'mark' }>;

export type ReactInlineViewProps<D extends InlineDefinition> = InlineViewFrame<D>;

export type ReactMarkViewProps<D extends MarkDefinition> = MarkViewFrame<D>;

function renderer<Frame extends object>(component: ComponentType<Frame>) {
  const Component = memo(component);

  return ({ createOverlay }: RangeViewMount): RangeView<Frame> => {
    const element = createOverlay();
    const portals = portalHostFor(element);

    return {
      update(frame) {
        portals.render(element, <Component {...frame} />);
      },
      destroy() {
        portals.remove(element);
      },
    };
  };
}

/** An inline object's presentation reserves space; React owns its interactive contents. */
export function defineReactInlineView<D extends InlineDefinition>(
  definition: D,
  component: ComponentType<ReactInlineViewProps<D>>,
) {
  const render = renderer(component);

  return defineInlineView(definition, () => render);
}

/** One component receives all visible line fragments for a semantic mark range. */
export function defineReactMarkView<D extends MarkDefinition>(
  definition: D,
  component: ComponentType<ReactMarkViewProps<D>>,
) {
  const render = renderer(component);

  return defineMarkView(definition, () => render);
}
