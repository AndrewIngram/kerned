import { useLayoutEffect, useRef } from 'react';

import type { createNodeViews, NodeView, NodeViewFrame } from '../editor-browser/node-views';
import type { NodeIdentity } from '../model';

/** React only attaches and updates the native view supplied by an extension. */
export function NodeViewContent<N extends NodeIdentity>({
  renderer,
  ...frame
}: NodeViewFrame<N> & {
  renderer: NonNullable<ReturnType<ReturnType<typeof createNodeViews<N>>['find']>>;
}) {
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<NodeView<N> | null>(null);
  useLayoutEffect(() => {
    if (!element.current || renderer.isDestroyed) return undefined;
    const mounted = renderer.mount(element.current);
    view.current = mounted;

    return () => {
      view.current = null;
      mounted.destroy();
    };
  }, [renderer]);
  useLayoutEffect(() => {
    if (view.current && !view.current.isDestroyed) view.current.update(frame);
  });

  return <div ref={element} />;
}
