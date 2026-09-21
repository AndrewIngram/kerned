import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { observeEditorViewport } from '../editor-browser';

export function useEditorViewport(scroller: RefObject<HTMLDivElement | null>, page: boolean) {
  const toolbarRef = useRef<HTMLElement>(null);

  const [viewportHeight, setViewportHeight] = useState(520),
    [toolbarHeight, setToolbarHeight] = useState(50);

  const [zoom, setZoom] = useState(1),
    [width, setWidth] = useState(620),
    [scroll, setScroll] = useState(0);

  function readScroll() {
    return page ? window.scrollY : (scroller.current?.scrollTop ?? 0);
  }

  function scrollDocumentTo(top: number) {
    if (page) window.scrollTo({ top, behavior: 'instant' });
    else if (scroller.current) scroller.current.scrollTop = top;
  }

  useLayoutEffect(() => {
    const el = scroller.current;

    if (!el) return;

    return observeEditorViewport({
      element: el,
      scrollport: page ? window : el,
      toolbar: toolbarRef.current,
      onChange: ({ width, height, inset, scrollTop }) => {
        setWidth(width);
        setViewportHeight(height);
        setToolbarHeight(inset);
        setScroll(scrollTop);
      },
    });
  }, [page, scroller]);

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
