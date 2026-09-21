import type { NodeIdentity } from '../model';
import type { ExtensionUpdate } from './extension-state';
import type { EditorState } from './transactions';

type DocumentUpdate<N extends NodeIdentity> = Exclude<
  ExtensionUpdate<N>,
  { kind: 'selection' | 'storedMarks' | 'permissions' }
>;

/** Semantic notifications precede view invalidation; destruction is terminal. */
export type EditorEvents<N extends NodeIdentity> = {
  update: ExtensionUpdate<N>;
  transaction: DocumentUpdate<N>;
  content: DocumentUpdate<N>;
  selection: ExtensionUpdate<N>;
  destroy: { readonly state: EditorState<N> };
};

type EventListeners<N extends NodeIdentity> = {
  [Key in keyof EditorEvents<N>]: Set<(event: EditorEvents<N>[Key]) => void>;
};

function invoke(listener: () => void) {
  try {
    listener();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

/** Snapshot every channel together so registration changes affect only future publications. */
export function createEditorEvents<N extends NodeIdentity>() {
  const listeners: EventListeners<N> = {
    update: new Set(),
    transaction: new Set(),
    content: new Set(),
    selection: new Set(),
    destroy: new Set(),
  };

  const views = new Set<() => void>();

  return {
    on<Key extends keyof EditorEvents<N>>(
      name: Key,
      listener: (event: EditorEvents<N>[Key]) => void,
    ) {
      listeners[name].add(listener);

      return () => {
        listeners[name].delete(listener);
      };
    },
    subscribe(listener: () => void) {
      views.add(listener);

      return () => {
        views.delete(listener);
      };
    },
    publish(event: ExtensionUpdate<N>) {
      const pending = {
        update: [...listeners.update],
        transaction: [...listeners.transaction],
        content: [...listeners.content],
        selection: [...listeners.selection],
        views: [...views],
      };

      for (const listener of pending.update) invoke(() => listener(event));

      if (event.kind === 'transaction' || event.kind === 'undo' || event.kind === 'redo') {
        for (const listener of pending.transaction) invoke(() => listener(event));

        if (event.before.nodes !== event.after.nodes)
          for (const listener of pending.content) invoke(() => listener(event));
      }

      if (!event.before.selection.eq(event.after.selection))
        for (const listener of pending.selection) invoke(() => listener(event));

      for (const listener of pending.views) invoke(listener);
    },
    destroy(state: EditorState<N>) {
      const pending = [...listeners.destroy];

      for (const channel of Object.values(listeners)) channel.clear();
      views.clear();

      for (const listener of pending) invoke(() => listener({ state }));
    },
  };
}
