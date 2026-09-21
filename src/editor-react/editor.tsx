import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
} from 'react';

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
  diagnostics,
  zoom = 1,
  paddingTop = 0,
  maxWidth = null,
  background = '#ffffff',
  onReady,
  onError,
  onNotice,
  ...props
}: EditorProps<N>) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onError, onNotice });
  const configuration = useRef({ zoom, paddingTop, maxWidth, background });
  const view = useRef<MountedEditor | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);

  useLayoutEffect(() => {
    callbacks.current = { onReady, onError, onNotice };
    configuration.current = { zoom, paddingTop, maxWidth, background };
  });
  useLayoutEffect(() => {
    const mounted = view.current;

    if (mounted?.isDestroyed) view.current = undefined;
    else mounted?.update({ zoom, paddingTop, maxWidth, background });
  }, [zoom, paddingTop, maxWidth, background]);
  useLayoutEffect(() => {
    const element = host.current;

    if (!element || editor.isDestroyed) return undefined;
    let mounted: MountedEditor | undefined;
    let active = true;
    let reported = false;

    function report(failure: Error) {
      if (!active) return;
      reported = true;

      if (view.current === mounted) view.current = undefined;
      setError(failure);
      callbacks.current.onError?.(failure);
    }

    async function initialize(target: HTMLElement) {
      await Promise.resolve();

      if (!active || editor.isDestroyed) return;

      try {
        mounted = mountEditor(target, {
          editor,
          resolveAsset,
          scroll,
          toolbar,
          diagnostics,
          ...configuration.current,
          onError: report,
          onNotice: (message) => callbacks.current.onNotice?.(message),
        });
        view.current = mounted;
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

      if (view.current === mounted) view.current = undefined;
      mounted?.destroy();
    };
  }, [editor, resolveAsset, scroll, toolbar, diagnostics]);

  return (
    <>
      <div {...props} ref={host} />
      {error && <div role="alert">{error.message}</div>}
    </>
  );
}

const noView = () => null;

const noSubscription = () => () => {};

/** Subscribe to geometry without owning the view or its session. */
export function useViewState(view: MountedEditor | null) {
  return useSyncExternalStore(
    view?.subscribe ?? noSubscription,
    view?.getSnapshot ?? noView,
    noView,
  );
}
