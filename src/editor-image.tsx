import { useLayoutEffect, useRef, useState } from 'react';

import { streamConfig } from './editor-stream';
import type { ImageNode } from './extensions/demo-model';

const decoded = new Map<string, { width: number; height: number }>();

export function ImageBlock({
  node,
  width,
  onMeasure,
}: {
  node: ImageNode;
  width: number;
  onMeasure: (id: number, width: number, height: number) => void;
}) {
  const [size, setSize] = useState(() => decoded.get(node.src));
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (size) return undefined;
    let active = true;

    const timer = setTimeout(() => {
      void (async () => {
        const image = new Image();
        image.src = node.src;

        try {
          await image.decode();
          const next = { width: image.naturalWidth, height: image.naturalHeight };
          decoded.set(node.src, next);

          if (active) setSize(next);
        } catch {
          if (active) setFailed(true);
        }
      })();
    }, streamConfig.imageDelay);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [node.src, size]);
  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return undefined;
    const report = () => onMeasure(node.id, width, element.offsetHeight);
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();

    return () => observer.disconnect();
  }, [node.id, width, onMeasure]);

  return (
    <div
      ref={ref}
      data-image={node.id}
      className="image-block"
      style={{ height: size ? (width * size.height) / size.width : 96 }}
    >
      {size ? (
        <img src={node.src} alt={node.alt} width={size.width} height={size.height} />
      ) : (
        <span>{failed ? 'Image unavailable' : 'Loading illustration…'}</span>
      )}
    </div>
  );
}
