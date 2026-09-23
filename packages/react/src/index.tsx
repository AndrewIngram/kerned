import type { CommandState } from '@kerned/state';
import { useMemo, useSyncExternalStore } from 'react';

export { EditorContent, useViewState, type EditorContentProps } from './editor-content.js';

export { useEditor } from './use-editor.js';

export { createEditorContext } from './context.js';

export { defineReactNodeView, type ReactNodeViewProps } from './node-view.js';

export { defineReactWidgetView, type ReactWidgetViewProps } from './widget-view.js';

export {
  defineReactInlineView,
  defineReactMarkView,
  type ReactInlineViewProps,
  type ReactMarkViewProps,
} from './range-view.js';

type SnapshotSource<State> = {
  readonly state: State;
  subscribe(this: void, listener: () => void): () => void;
};

const noSnapshot = () => undefined;

const noSubscription = () => () => {};

function createSelectedSnapshot<State, Value>(
  editor: SnapshotSource<State>,
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
  editor: SnapshotSource<State>,
  selector: (state: State) => Value,
  equal?: (a: Value, b: Value) => boolean,
): Value;
export function useEditorState<State, Value>(
  editor: SnapshotSource<State> | null,
  selector: (state: State) => Value,
  equal?: (a: Value, b: Value) => boolean,
): Value | undefined;
export function useEditorState<State, Value>(
  editor: SnapshotSource<State> | null,
  selector: (state: State) => Value,
  equal: (a: Value, b: Value) => boolean = Object.is,
): Value | undefined {
  const snapshot = useMemo(
    () => (editor ? createSelectedSnapshot(editor, selector, equal) : noSnapshot),
    [editor, selector, equal],
  );

  return useSyncExternalStore(editor?.subscribe ?? noSubscription, snapshot, snapshot);
}

type CommandSource<State, Request extends unknown[]> = SnapshotSource<State> & {
  readonly getCommandState: (...request: Request) => CommandState;
};

/** Observe an installed command by name, with the same inferred arguments as the session. */
export function useCommandState<State, Request extends unknown[]>(
  editor: CommandSource<State, Request>,
  ...request: NoInfer<Request>
): CommandState;
export function useCommandState<State, Request extends unknown[]>(
  editor: CommandSource<State, Request> | null,
  ...request: NoInfer<Request>
): CommandState | undefined;
export function useCommandState<State, Request extends unknown[]>(
  editor: CommandSource<State, Request> | null,
  ...request: NoInfer<Request>
): CommandState | undefined {
  return useEditorState(
    editor,
    () => editor?.getCommandState(...request),
    (a, b) => a?.available === b?.available && a?.activity === b?.activity,
  );
}

export { NodeViewContent } from './node-view-content.js';
