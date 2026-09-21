import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react';

import { mountEditorView, type BrowserViewOptions } from '../editor-browser';

/** Optional React host. The caller owns the session and supplies its renderer as children. */
export function Editor({
  view,
  children,
  ...props
}: ComponentPropsWithoutRef<'div'> & { view: BrowserViewOptions }) {
  const element = useRef<HTMLDivElement>(null),
    runtime = useRef<ReturnType<typeof mountEditorView> | null>(null);

  const currentView = useRef(view);
  useLayoutEffect(() => {
    currentView.current = view;
  });
  useLayoutEffect(() => {
    if (!element.current || view.session?.isDestroyed) return undefined;
    const mounted = mountEditorView(element.current, currentView.current);
    runtime.current = mounted;

    return () => {
      mounted.destroy();
      runtime.current = null;
    };
  }, [view.session]);
  useLayoutEffect(() => {
    if (runtime.current && !runtime.current.isDestroyed) runtime.current.update(view);
  });

  return (
    <div {...props} ref={element}>
      {children}
    </div>
  );
}
