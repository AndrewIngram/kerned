import { useLayoutEffect, useRef } from 'react';

import type { ObserveTextPointer } from '../../editor-browser';
import { useCanvasLayer } from '../../editor-react';
import { createBlockLayer, type BlockLayerFrame } from './native-block-layer';
import type { EditorSession, Owned } from './types';

/** React only attaches the native block layer and supplies its current frame. */
export function BlockLayer({
  editor,
  owned,
  onTextPointer,
  ...frame
}: BlockLayerFrame & {
  editor: EditorSession;
  owned: Pick<Owned, 'layoutText'>;
  onTextPointer: ObserveTextPointer;
}) {
  const register = useCanvasLayer();
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<typeof createBlockLayer> | null>(null);
  useLayoutEffect(() => {
    if (!element.current || editor.isDestroyed) return undefined;
    const mounted = createBlockLayer(element.current, { editor, owned, register, onTextPointer });
    view.current = mounted;

    return () => {
      view.current = null;
      mounted.destroy();
    };
  }, [editor, owned, register, onTextPointer]);
  useLayoutEffect(() => {
    if (view.current && !view.current.isDestroyed) view.current.update(frame);
  });

  return <div ref={element} />;
}
