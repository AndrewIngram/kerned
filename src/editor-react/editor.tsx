import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';

import { mountEditor, type MountEditorOptions, type MountedEditor } from '../editor-canvas';
import type { NodeIdentity } from '../model';

type EditorProps<N extends NodeIdentity> = MountEditorOptions<N> &
  Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'onError'> & {
    onReady?: (view: MountedEditor) => void;
    onError?: (error: Error) => void;
  };

/** Optional React attachment to the same native view used by vanilla applications. */
export function Editor<N extends NodeIdentity>({
  editor,
  resolveAsset,
  scroll,
  toolbar,
  onReady,
  onError,
  ...props
}: EditorProps<N>) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onError });
  const [error, setError] = useState<Error | null>(null);

  useLayoutEffect(() => {
    callbacks.current = { onReady, onError };
  });
  useLayoutEffect(() => {
    const element = host.current;

    if (!element || editor.isDestroyed) return undefined;
    let mounted: MountedEditor | undefined;
    let active = true;
    let reported = false;

    function report(failure: Error) {
      if (!active) return;
      reported = true;
      setError(failure);
      callbacks.current.onError?.(failure);
    }

    async function initialize(target: HTMLElement) {
      await Promise.resolve();

      if (!active || editor.isDestroyed) return;

      try {
        mounted = mountEditor(target, { editor, resolveAsset, scroll, toolbar, onError: report });
        await mounted.ready;

        if (active && !mounted.isDestroyed) {
          setError(null);
          callbacks.current.onReady?.(mounted);
        }
      } catch (reason) {
        if (!reported) report(reason instanceof Error ? reason : new Error(String(reason)));
      }
    }

    void initialize(element);

    return () => {
      active = false;
      mounted?.destroy();
    };
  }, [editor, resolveAsset, scroll, toolbar]);

  return (
    <>
      <div {...props} ref={host} />
      {error && <div role="alert">{error.message}</div>}
    </>
  );
}
