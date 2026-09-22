import type { NodeIdentity } from '@gprose/model';
import {
  defaultFonts,
  defaultAccessibility,
  mountEditor,
  type MountEditorOptions,
  type MountedEditor,
} from '@gprose/view';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
} from 'react';

import { createPortalHost, EditorPortals } from './portals.js';

export type EditorContentProps<N extends NodeIdentity> = Omit<MountEditorOptions<N>, 'editor'> & {
  editor: MountEditorOptions<N>['editor'] | null;
} & Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'onError'> & {
    onReady?: (view: MountedEditor) => void;
    onError?: (error: Error) => void;
  };

const defaultTheme = Object.freeze({});

/** Optional React attachment to the same native view used by vanilla applications. */
export function EditorContent<N extends NodeIdentity>({
  editor,
  resolveAsset,
  fonts = defaultFonts,
  scroll,
  toolbar,
  diagnostics,
  accessibility: accessibilityProp,
  zoom = 1,
  paddingTop = 0,
  maxWidth = null,
  background = '#ffffff',
  theme = defaultTheme,
  onReady,
  onError,
  onNotice,
  ...props
}: EditorContentProps<N>) {
  const accessibility = useMemo(
    () => ({
      readingView: accessibilityProp?.readingView ?? defaultAccessibility.readingView,
      label: accessibilityProp?.label ?? defaultAccessibility.label,
      description: accessibilityProp?.description ?? defaultAccessibility.description,
    }),
    [accessibilityProp],
  );

  const host = useRef<HTMLDivElement>(null);
  const [portals] = useState(createPortalHost);
  const callbacks = useRef({ onReady, onError, onNotice });

  const configuration = useRef({
    zoom,
    paddingTop,
    maxWidth,
    background,
    theme,
    fonts,
    accessibility,
  });

  const view = useRef<MountedEditor | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);

  useLayoutEffect(() => {
    callbacks.current = { onReady, onError, onNotice };
    configuration.current = { zoom, paddingTop, maxWidth, background, theme, fonts, accessibility };
  });
  useLayoutEffect(() => {
    const mounted = view.current;

    if (mounted?.isDestroyed) view.current = undefined;
    else mounted?.update({ zoom, paddingTop, maxWidth, background, theme, accessibility });
  }, [zoom, paddingTop, maxWidth, background, theme, accessibility]);
  useLayoutEffect(() => {
    const mounted = view.current;

    if (!mounted || mounted.isDestroyed) return undefined;
    let active = true;

    async function replaceFonts(target: MountedEditor) {
      try {
        await target.setFonts(fonts);

        if (active) setError(null);
      } catch (reason) {
        if (!active) return;
        const failure = reason instanceof Error ? reason : new Error(String(reason));
        setError(failure);
        callbacks.current.onError?.(failure);
      }
    }

    void replaceFonts(mounted);

    return () => {
      active = false;
    };
  }, [fonts]);
  useLayoutEffect(() => {
    const element = host.current;

    if (!element || !editor || editor.isDestroyed) return undefined;
    const session = editor;
    const detachPortals = portals.attach(element);
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

      if (!active || session.isDestroyed) return;

      try {
        mounted = mountEditor(target, {
          editor: session,
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
        await portals.whenCommitted();

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

      try {
        mounted?.destroy();
      } finally {
        detachPortals();
      }
    };
  }, [editor, resolveAsset, scroll, toolbar, diagnostics, portals]);

  return (
    <>
      <div {...props} ref={host}>
        <EditorPortals host={portals} />
      </div>
      {editor && error && <div role="alert">{error.message}</div>}
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
