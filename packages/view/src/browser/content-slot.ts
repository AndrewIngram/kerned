/** One attachment point for a flowing node's canvas-owned descendants. */
export type ContentSlot = {
  attach(element: HTMLElement): () => void;
};

export type SlotInsets = Readonly<{ top: number; right: number; bottom: number; left: number }>;

/** Owns DOM measurement only. The mounted view owns layout, document state and text input. */
export function createContentSlot({
  root,
  measure,
  onError,
}: {
  root: HTMLElement;
  measure: (insets: SlotInsets) => void;
  onError: (error: Error) => void;
}) {
  let frame: { width: number; height: number } | undefined;
  let attachment: { element: HTMLElement; release: () => void } | undefined;
  let previous: SlotInsets | undefined;
  let scheduled = 0;
  let destroyed = false;

  function schedule() {
    if (destroyed || !attachment || !frame || scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;

      if (destroyed || !attachment || !frame || !root.isConnected) return;

      try {
        if (!root.contains(attachment.element))
          throw new Error('Content slot left its node renderer');
        const outside = root.getBoundingClientRect();
        const inside = attachment.element.getBoundingClientRect();
        const scale = outside.width / frame.width;

        if (!Number.isFinite(scale) || scale <= 0) return;

        const values = {
          top: (inside.top - outside.top) / scale,
          right: (outside.right - inside.right) / scale,
          bottom: (outside.bottom - inside.bottom) / scale,
          left: (inside.left - outside.left) / scale,
        };

        if (Object.values(values).some((value) => !Number.isFinite(value) || value < -0.5))
          throw new Error('A content slot must fit within its node renderer');

        const insets = {
          top: Math.max(0, values.top),
          right: Math.max(0, values.right),
          bottom: Math.max(0, values.bottom),
          left: Math.max(0, values.left),
        };

        // DOM rectangles can drift by subpixels at fractional zoom levels.
        if (
          previous &&
          Math.abs(previous.top - insets.top) < 0.1 &&
          Math.abs(previous.right - insets.right) < 0.1 &&
          Math.abs(previous.bottom - insets.bottom) < 0.1 &&
          Math.abs(previous.left - insets.left) < 0.1
        )
          return;
        previous = insets;
        measure(insets);
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  const observer = new ResizeObserver(schedule);
  const mutations = new MutationObserver(schedule);

  const content: ContentSlot = {
    attach(element) {
      if (destroyed) throw new Error('Content slot is destroyed');

      if (attachment) throw new Error('Content slot is already attached');

      if (element === root || !root.contains(element))
        throw new Error('Content slot must be inside its node renderer');
      const height = element.style.height;

      const release = () => {
        if (attachment?.release !== release) return;
        attachment = undefined;
        observer.disconnect();
        mutations.disconnect();
        cancelAnimationFrame(scheduled);
        scheduled = 0;
        element.style.height = height;
        previous = undefined;
      };

      attachment = { element, release };

      if (frame) element.style.height = `${frame.height}px`;
      observer.observe(root);
      observer.observe(element);
      mutations.observe(root, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      schedule();

      return release;
    },
  };

  return {
    content,
    update(width: number, height: number) {
      if (destroyed) throw new Error('Content slot is destroyed');
      frame = { width, height };

      if (attachment) attachment.element.style.height = `${height}px`;
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      attachment?.release();
      observer.disconnect();
      mutations.disconnect();
      frame = undefined;
    },
  };
}
