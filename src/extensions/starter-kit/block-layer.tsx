import { useLayoutEffect, useRef } from 'react';

import { useCanvasLayer } from '../../editor-react';
import { createBlockLayer, type BlockLayerFrame } from './native-block-layer';
import type { EditorSession, Owned } from './types';

/** React only attaches the native block layer and supplies its current frame. */
export function BlockLayer({
  editor,
  owned,
  ...frame
}: BlockLayerFrame & {
  editor: EditorSession;
  owned: Pick<Owned, 'layoutText'>;
}) {
  const register = useCanvasLayer();
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<typeof createBlockLayer> | null>(null);
  useLayoutEffect(() => {
    if (!element.current || editor.isDestroyed) return undefined;
    const mounted = createBlockLayer(element.current, { editor, owned, register });
    view.current = mounted;

    return () => {
      view.current = null;
      mounted.destroy();
    };
  }, [editor, owned, register]);
  useLayoutEffect(() => {
    if (view.current && !view.current.isDestroyed) view.current.update(frame);
  });

  return <div ref={element} />;
}
