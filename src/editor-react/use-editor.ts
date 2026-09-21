import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { createEditor, type Editor, type EditorOptions } from '../core';
import type { NodeIdentity, SchemaDefinition } from '../model';

/** An empty owner is safe to create during render; only attachment allocates a session. */
function createOwner<D extends readonly SchemaDefinition[], N extends NodeIdentity>(
  schema: Editor<D, N>['schema'],
  documentId: string | undefined,
) {
  let current: Editor<D, N> | null = null;
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => current,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    attach(options: EditorOptions<D, N>) {
      const editor = createEditor({ ...options, schema, documentId });
      current = editor;

      const detach = editor.on('destroy', () => {
        if (current === editor) {
          current = null;
          notify();
        }
      });

      notify();

      return () => {
        detach();

        if (current === editor) current = null;
        editor.destroy();
        notify();
      };
    },
  };
}

const noEditor = () => null;

/** Own a headless session after commit; content options initialize, rather than control, it. */
export function useEditor<const D extends readonly SchemaDefinition[], N extends NodeIdentity>(
  options: EditorOptions<D, N>,
): Editor<D, N> | null {
  const initial = useRef(options);

  const owner = useMemo(
    () => createOwner<D, N>(options.schema, options.documentId),
    [options.schema, options.documentId],
  );

  useLayoutEffect(() => {
    initial.current = options;
  });
  useEffect(() => owner.attach(initial.current), [owner]);

  return useSyncExternalStore(owner.subscribe, owner.getSnapshot, noEditor);
}
