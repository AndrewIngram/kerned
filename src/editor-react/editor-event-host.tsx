import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react';

import { mountEditorView, type BrowserViewOptions } from '../editor-browser';

/** Internal event attachment for the demo while its full mounted-view migration is in progress. */
export function EditorEventHost({
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
