import { useLayoutEffect, useRef } from 'react';

import { createTableView, type TableFrame } from './starter-kit/table-view';

/** React attaches the same native table controller used by non-React hosts. */
export function TableBlock(frame: TableFrame) {
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<typeof createTableView> | null>(null);
  useLayoutEffect(() => {
    if (!element.current) return undefined;
    const mounted = createTableView(element.current);
    view.current = mounted;

    return () => {
      view.current = null;
      mounted.destroy();
    };
  }, []);
  useLayoutEffect(() => {
    view.current?.update(frame);
  });

  return <div ref={element} />;
}
