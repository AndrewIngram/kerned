import { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import type {
  CanvasPainter,
  CanvasPaintLayer,
  RegisterCanvasPainter,
} from '../editor-canvas/canvas-renderer';
import type { NodeIdentity } from '../model';
import type { EditorState, CommandDefinition, CommandState } from '../state';

export type {
  CanvasPainter,
  CanvasPaintLayer,
  RegisterCanvasPainter,
} from '../editor-canvas/canvas-renderer';

const PaintContext = createContext<RegisterCanvasPainter | null>(null);

export const CanvasLayerProvider = PaintContext.Provider;

/** Canvas extensions share the host's viewport pass and release registration on unmount. */
export function CanvasPrimitive({
  id,
  paint,
  layer = 'content',
}: {
  id: string;
  paint: CanvasPainter;
  layer?: CanvasPaintLayer;
}) {
  const register = useContext(PaintContext);

  if (!register) throw new Error('CanvasPrimitive requires a CanvasLayerProvider');
  useLayoutEffect(() => register(id, paint, layer), [register, id, paint, layer]);

  return null;
}

export { usePointerSelection } from './pointer-selection';

export { Editor } from './editor';

export { createReactRenderers, type ReactRenderer } from './renderers';

function createSelectedSnapshot<State, Value>(
  editor: { readonly state: State; subscribe(this: void, listener: () => void): () => void },
  selector: (state: State) => Value,
  equal: (a: Value, b: Value) => boolean = Object.is,
) {
  let cached: { state: State; value: Value } | undefined;

  return () => {
    const state = editor.state;

    if (cached && Object.is(cached.state, state)) return cached.value;
    const value = selector(state);
    cached = { state, value: cached && equal(cached.value, value) ? cached.value : value };

    return cached.value;
  };
}

/** React is an optional subscriber to a headless editor session. */
export function useEditorState<State, Value>(
  editor: { readonly state: State; subscribe(this: void, listener: () => void): () => void },
  selector: (state: State) => Value,
  equal: (a: Value, b: Value) => boolean = Object.is,
): Value {
  const snapshot = useMemo(
    () => createSelectedSnapshot(editor, selector, equal),
    [editor, selector, equal],
  );

  return useSyncExternalStore(editor.subscribe, snapshot, snapshot);
}

export function useCommandState<N extends NodeIdentity, Args extends unknown[]>(
  editor: {
    readonly state: EditorState<N>;
    subscribe(listener: () => void): () => void;
    commandState(command: CommandDefinition<N, Args>, ...args: Args): CommandState;
  },
  command: CommandDefinition<N, Args>,
  ...args: Args
): CommandState {
  return useEditorState(
    editor,
    () => editor.commandState(command, ...args),
    (a, b) => a.available === b.available && a.activity === b.activity,
  );
}

export { useCanvasInput } from './use-canvas-input';

export { useEditorViewport, type Viewport } from './use-viewport';
