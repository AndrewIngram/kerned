import type { ContentSlot } from '@gprose/view';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';

/** Reserve canvas-owned child content inside a custom node's React chrome. */
export function NodeViewContent({
  content,
  className,
  style,
}: {
  content: ContentSlot | null;
  className?: string;
  style?: CSSProperties;
}) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    return content && element.current ? content.attach(element.current) : undefined;
  }, [content]);

  return content ? (
    <div ref={element} className={className} style={style} data-editor-slot="" />
  ) : null;
}
