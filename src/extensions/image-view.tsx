import { useLayoutEffect, useRef } from 'react';

import type { ImageFrame, ImageRenderer } from './starter-kit/image-view';

/** React attaches the same native image view used by a vanilla host. */
export function ImageBlock({ renderer, ...frame }: ImageFrame & { renderer: ImageRenderer }) {
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<ImageRenderer> | null>(null);
  useLayoutEffect(() => {
    if (!element.current) return undefined;
    const mounted = renderer(element.current);
    view.current = mounted;

    return () => {
      view.current = null;
      mounted.destroy();
    };
  }, [renderer]);
  useLayoutEffect(() => {
    view.current?.update(frame);
  });

  return <div ref={element} />;
}
