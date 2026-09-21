import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react';

import { createEditorViewport } from '../editor-browser';

/** React attaches browser observation and subscribes; it owns no viewport state. */
export function useEditorViewport(scrollerRef: RefObject<HTMLDivElement | null>, page: boolean) {
  const toolbarRef = useRef<HTMLElement>(null);
  const controller = useMemo(() => createEditorViewport(), []);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useLayoutEffect(() => {
    const element = scrollerRef.current;

    return element
      ? controller.attach({
          element,
          scrollport: page ? window : element,
          toolbar: toolbarRef.current,
        })
      : undefined;
  }, [controller, page, scrollerRef]);

  return {
    toolbarRef,
    viewportHeight: snapshot.height,
    toolbarHeight: snapshot.inset,
    zoom: snapshot.zoom,
    setZoom: controller.setZoom,
    width: snapshot.width,
    scroll: snapshot.scrollTop,
    readScroll: controller.readScroll,
    scrollDocumentTo: controller.scrollTo,
  };
}

export type Viewport = ReturnType<typeof useEditorViewport>;
