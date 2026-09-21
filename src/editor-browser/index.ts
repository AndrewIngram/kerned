import { createPointerSelection, type PointerSelectionOptions } from './pointer-selection';

export { createPointerSelection, type PointerSelectionOptions } from './pointer-selection';

export { observeEditorViewport, type EditorViewport } from './viewport';

export { createTextInput } from './text-input';

export type BrowserViewOptions = {
  pointer: PointerSelectionOptions;
  input?: {
    element: () => HTMLTextAreaElement | null;
    keydown?: (event: KeyboardEvent) => void;
    input?: (event: Event, input: HTMLTextAreaElement) => void;
    copy?: (event: ClipboardEvent) => void;
    cut?: (event: ClipboardEvent) => void;
    paste?: (event: ClipboardEvent) => void;
    compositionstart?: () => void;
    compositionend?: () => void;
    focus?: (focused: boolean) => void;
  };
};

/** Framework-independent event ownership. Destroying a view never destroys its session. */
export function mountEditorView(element: HTMLElement, initial: BrowserViewOptions) {
  let options = initial,
    destroyed = false;

  const pointer = createPointerSelection({
    context: () => options.pointer.context?.(),
    nodeAt: (target) => options.pointer.nodeAt?.(target) ?? null,
    hitTest: (x, y) => options.pointer.hitTest(x, y),
    selection: () => options.pointer.selection(),
    onSelect: (selection) => options.pointer.onSelect(selection),
    focus: () => options.pointer.focus(),
    selectRange: (hit, clicks) => options.pointer.selectRange?.(hit, clicks) ?? null,
    onStart: (hit, clicks) => options.pointer.onStart?.(hit, clicks),
    onDrag: (hit) => options.pointer.onDrag?.(hit),
  });

  const cleanup: (() => void)[] = [];

  function listen<K extends keyof HTMLElementEventMap>(
    name: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ) {
    element.addEventListener(name, handler);
    cleanup.push(() => element.removeEventListener(name, handler));
  }

  listen('pointerdown', pointer.onPointerDown);
  listen('mousedown', pointer.onMouseDown);
  listen('pointermove', pointer.onPointerMove);
  listen('pointerup', pointer.onPointerUp);
  listen('pointercancel', pointer.onPointerCancel);
  listen('lostpointercapture', pointer.onLostPointerCapture);
  const isInput = (event: Event) => event.target === options.input?.element();
  listen('keydown', (event) => {
    if (isInput(event)) options.input?.keydown?.(event);
  });
  listen('input', (event) => {
    const input = options.input?.element();

    if (input && event.target === input) options.input?.input?.(event, input);
  });
  listen('copy', (event) => {
    if (isInput(event)) options.input?.copy?.(event);
  });
  listen('cut', (event) => {
    if (isInput(event)) options.input?.cut?.(event);
  });
  listen('paste', (event) => {
    if (isInput(event)) options.input?.paste?.(event);
  });
  listen('compositionstart', (event) => {
    if (isInput(event)) options.input?.compositionstart?.();
  });
  listen('compositionend', (event) => {
    if (isInput(event)) options.input?.compositionend?.();
  });
  listen('focusin', (event) => {
    if (isInput(event)) options.input?.focus?.(true);
  });
  listen('focusout', (event) => {
    if (isInput(event)) options.input?.focus?.(false);
  });

  return {
    update(next: BrowserViewOptions) {
      if (destroyed) throw new Error('Editor view is destroyed');
      options = next;
    },
    focus() {
      if (!destroyed) options.pointer.focus();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pointer.onPointerCancel();

      for (const dispose of cleanup) dispose();
    },
  };
}

export { createTextInteraction, positionTextInput } from './text-interaction';

export { hitTestTextLines, type TextHit, type TextHitRegion } from './hit-testing';

export {
  createTextNavigation,
  type NavigationBlock,
  type NavigationLayout,
  type NavigationKey,
} from './keyboard-navigation';

export { selectionView, textSelectionAtClick } from './selection-view';

export { textBoundaryNearNode, moveNodeSelection, type NavigationNode } from './node-navigation';
