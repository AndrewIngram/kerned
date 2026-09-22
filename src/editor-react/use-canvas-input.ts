import type { NodeIdentity, Schema } from '@gprose/model';
import { useLayoutEffect, useMemo, type RefObject } from 'react';

import {
  createCanvasInput,
  type CanvasInputFrame,
  type CanvasInputSession,
} from '../editor-browser/canvas-input';

type CanvasInputOptions<N extends NodeIdentity> = CanvasInputFrame<N> & {
  schema: Schema<N>;
  editor: CanvasInputSession<N>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

/** React only attaches native input and supplies the committed layout frame. */
export function useCanvasInput<N extends NodeIdentity>({
  schema,
  editor,
  canvasRef,
  inputRef,
  ...frame
}: CanvasInputOptions<N>) {
  const controller = useMemo(() => createCanvasInput({ schema, editor }), [schema, editor]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current,
      input = inputRef.current;

    return canvas && input ? controller.attach(canvas, input) : undefined;
  }, [controller, canvasRef, inputRef]);
  useLayoutEffect(() => {
    controller.update(frame);
  });

  return controller;
}
