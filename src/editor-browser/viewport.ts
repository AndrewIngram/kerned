export type EditorViewport = { width: number; height: number; scrollTop: number; inset: number };

/** Observe an editor embedded in a scrollport or a page with a sticky toolbar. */
export function observeEditorViewport(options: {
  element: HTMLElement;
  scrollport: HTMLElement | Window;
  toolbar?: HTMLElement | null;
  onChange: (viewport: EditorViewport) => void;
}) {
  const { element, scrollport, toolbar, onChange } = options;
  const page = scrollport instanceof Window;

  const measure = () =>
    onChange({
      width: element.clientWidth,
      inset: toolbar?.offsetHeight ?? 0,
      height: Math.max(
        1,
        page ? scrollport.innerHeight - (toolbar?.offsetHeight ?? 0) : scrollport.clientHeight,
      ),
      scrollTop: page ? scrollport.scrollY : scrollport.scrollTop,
    });

  const observer = new ResizeObserver(measure);
  observer.observe(element);

  if (toolbar) observer.observe(toolbar);

  if (!page && scrollport !== element) observer.observe(scrollport);
  scrollport.addEventListener('scroll', measure, { passive: true });

  if (page) scrollport.addEventListener('resize', measure);
  measure();
  let destroyed = false;

  return () => {
    if (destroyed) return;
    destroyed = true;
    observer.disconnect();
    scrollport.removeEventListener('scroll', measure);

    if (page) scrollport.removeEventListener('resize', measure);
  };
}
