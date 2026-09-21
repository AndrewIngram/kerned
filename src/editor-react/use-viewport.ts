import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { observeEditorViewport } from '../editor-browser';

export function useEditorViewport(scrollerRef: RefObject<HTMLDivElement | null>, page: boolean) {
  const toolbarRef = useRef<HTMLElement>(null);

  const [viewportHeight, setViewportHeight] = useState(520),
    [toolbarHeight, setToolbarHeight] = useState(50);

  const [zoom, setZoom] = useState(1),
    [width, setWidth] = useState(620),
    [scroll, setScroll] = useState(0);

  const readScroll = useCallback(() => {
    return page ? window.scrollY : (scrollerRef.current?.scrollTop ?? 0);
  }, [page, scrollerRef]);

  const scrollDocumentTo = useCallback(
    (top: number) => {
      if (page) window.scrollTo({ top, behavior: 'instant' });
      else scrollerRef.current?.scrollTo({ top, behavior: 'instant' });
    },
    [page, scrollerRef],
  );

  useLayoutEffect(() => {
    const el = scrollerRef.current;

    if (!el) return undefined;

    return observeEditorViewport({
      element: el,
      scrollport: page ? window : el,
      toolbar: toolbarRef.current,
      onChange: ({ width: widthValue, height, inset, scrollTop }) => {
        setWidth(widthValue);
        setViewportHeight(height);
        setToolbarHeight(inset);
        setScroll(scrollTop);
      },
    });
  }, [page, scrollerRef]);

  return {
    toolbarRef,
    viewportHeight,
    toolbarHeight,
    zoom,
    setZoom,
    width,
    scroll,
    setScroll,
    readScroll,
    scrollDocumentTo,
  };
}

export type Viewport = ReturnType<typeof useEditorViewport>;
