export type EditorViewport = Readonly<{
  width: number;
  height: number;
  scrollTop: number;
  inset: number;
  zoom: number;
}>;

type ViewportAttachment = {
  element: HTMLElement;
  scrollport: HTMLElement | Window;
  toolbar?: HTMLElement | null;
};

/** Owns measured viewport state and scrolling, independently of a rendering framework. */
export function createEditorViewport() {
  let snapshot: EditorViewport = { width: 620, height: 520, inset: 50, scrollTop: 0, zoom: 1 };
  const listeners = new Set<() => void>();
  let attachment: (ViewportAttachment & { release: () => void }) | undefined;
  let destroyed = false;

  function assertAlive() {
    if (destroyed) throw new Error('Editor viewport has been destroyed');
  }

  function publish(next: EditorViewport) {
    if (
      snapshot.width === next.width &&
      snapshot.height === next.height &&
      snapshot.inset === next.inset &&
      snapshot.scrollTop === next.scrollTop &&
      snapshot.zoom === next.zoom
    )
      return;
    snapshot = next;

    for (const listener of listeners) listener();
  }

  function readScroll() {
    const port = attachment?.scrollport;

    return port ? ('scrollY' in port ? port.scrollY : port.scrollTop) : snapshot.scrollTop;
  }

  function measure() {
    if (!attachment) return;
    const { element, scrollport, toolbar } = attachment;
    const inset = toolbar?.offsetHeight ?? 0;
    publish({
      width: element.clientWidth,
      height: Math.max(
        1,
        'scrollY' in scrollport ? scrollport.innerHeight - inset : scrollport.clientHeight,
      ),
      inset,
      scrollTop: readScroll(),
      zoom: snapshot.zoom,
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      assertAlive();
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    readScroll,
    scrollTo(this: void, top: number) {
      assertAlive();

      if (!Number.isFinite(top)) throw new RangeError('Scroll position must be finite');

      if (!attachment) return;
      attachment.scrollport.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      // Native scroll events arrive later. Reveal and anchoring need the clamped
      // position immediately, without asking callers to synchronize a second store.
      measure();
    },
    setZoom(this: void, zoom: number) {
      assertAlive();

      if (!Number.isFinite(zoom) || zoom <= 0)
        throw new RangeError('Zoom must be finite and positive');
      publish({ ...snapshot, zoom });
    },
    attach(options: ViewportAttachment) {
      assertAlive();

      if (attachment) throw new Error('Editor viewport is already attached');
      const { element, scrollport, toolbar } = options;
      const page = 'scrollY' in scrollport;

      const observer = new ResizeObserver(() => {
        if (attachment?.release === release) measure();
      });

      const release = () => {
        if (attachment?.release !== release) return;
        attachment = undefined;
        observer.disconnect();
        scrollport.removeEventListener('scroll', measure);

        if (page) scrollport.removeEventListener('resize', measure);
      };

      attachment = { ...options, release };

      try {
        observer.observe(element);

        if (toolbar) observer.observe(toolbar);

        if (!page && scrollport !== element) observer.observe(scrollport);
        scrollport.addEventListener('scroll', measure, { passive: true });

        if (page) scrollport.addEventListener('resize', measure);
        measure();
      } catch (error) {
        release();
        throw error;
      }

      return release;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      attachment?.release();
      listeners.clear();
    },
  };
}
