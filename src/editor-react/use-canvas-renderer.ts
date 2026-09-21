import type { CanvasKit } from 'canvaskit-wasm';
import { useLayoutEffect, useMemo, type RefObject } from 'react';

import { createCanvasRenderer, type CanvasFrame } from '../editor-canvas/canvas-renderer';

/** React owns only attachment. Paint state and native resources belong to the controller. */
export function useCanvasRenderer<N>({
  kit,
  canvasRef,
  ...frame
}: CanvasFrame<N> & {
  kit: CanvasKit;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const renderer = useMemo(() => createCanvasRenderer<N>(), []);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;

    return canvas ? renderer.attach(kit, canvas) : undefined;
  }, [kit, canvasRef, renderer]);
  useLayoutEffect(() => {
    renderer.update(frame);
  });

  return { register: renderer.register, diagnostics: renderer.diagnostics };
}
