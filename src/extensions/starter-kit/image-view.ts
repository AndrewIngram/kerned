import type { ImageNode } from '../demo-model';

export type ImageFrame = {
  node: ImageNode;
  width: number;
  onMeasure: (id: number, width: number, height: number) => void;
};

type Dimensions = { width: number; height: number };

type ImageState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; size: Dimensions };

/** One renderer per mounted editor. Only bounded, decoded dimensions outlive a node view. */
export function createImageRenderer({ delay = 0 }: { delay?: number } = {}) {
  const dimensions = new Map<string, Dimensions>();

  return function mountImage(element: HTMLDivElement) {
    let frame: ImageFrame | undefined;
    let state: ImageState = { status: 'loading' };
    let pending: HTMLImageElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let destroyed = false;

    function report() {
      if (!destroyed && frame) frame.onMeasure(frame.node.id, frame.width, element.offsetHeight);
    }

    function paint() {
      if (!frame) return;
      element.dataset.image = String(frame.node.id);
      element.style.height =
        state.status === 'ready'
          ? `${(frame.width * state.size.height) / state.size.width}px`
          : '96px';

      if (state.status === 'ready') {
        const image = element.querySelector('img') ?? element.ownerDocument.createElement('img');

        if (image.getAttribute('src') !== frame.node.src) image.src = frame.node.src;
        image.alt = frame.node.alt;
        image.width = state.size.width;
        image.height = state.size.height;

        if (image.parentNode !== element) element.replaceChildren(image);
      } else {
        element.textContent =
          state.status === 'failed' ? 'Image unavailable' : 'Loading illustration…';
      }

      report();
    }

    function cancel() {
      clearTimeout(timer);
      timer = undefined;
      const image = pending;
      pending = undefined;
      image?.removeAttribute('src');
    }

    async function decode(image: HTMLImageElement, src: string) {
      try {
        await image.decode();

        if (destroyed || pending !== image) return;
        const size = { width: image.naturalWidth, height: image.naturalHeight };
        dimensions.delete(src);
        dimensions.set(src, size);
        const oldest = dimensions.keys().next();

        if (dimensions.size > 128 && !oldest.done) dimensions.delete(oldest.value);
        state = { status: 'ready', size };
        element.replaceChildren(image);
      } catch {
        if (destroyed || pending !== image) return;
        state = { status: 'failed' };
      }

      pending = undefined;
      paint();
    }

    const observer = new ResizeObserver(report);
    element.classList.add('image-block');
    observer.observe(element);

    return {
      update(next: ImageFrame) {
        if (destroyed) throw new Error('Image view is destroyed');

        if (
          frame?.node === next.node &&
          frame.width === next.width &&
          frame.onMeasure === next.onMeasure
        )
          return;
        const changed = !frame || frame.node.src !== next.node.src;
        frame = next;

        if (changed) {
          cancel();
          const size = dimensions.get(next.node.src);
          state = size ? { status: 'ready', size } : { status: 'loading' };

          if (!size) {
            timer = setTimeout(() => {
              timer = undefined;
              const image = element.ownerDocument.createElement('img');
              pending = image;
              image.src = next.node.src;
              void decode(image, next.node.src);
            }, delay);
          }
        }

        paint();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancel();
        observer.disconnect();
        frame = undefined;
        element.replaceChildren();
        element.style.removeProperty('height');
        delete element.dataset.image;
        element.classList.remove('image-block');
      },
    };
  };
}

export type ImageRenderer = ReturnType<typeof createImageRenderer>;
