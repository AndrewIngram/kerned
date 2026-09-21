import { connectEditorView, type EditorViewSession } from '../core';
import type { Selection } from '../state';
import { createPointerSelection, type PointerSelectionOptions } from './pointer-selection';

export { createPointerSelection, type PointerSelectionOptions } from './pointer-selection';

export { createEditorViewport, type EditorViewport } from './viewport';

export { createTextInput } from './text-input';

export type BrowserViewOptions = {
  session?: EditorViewSession;
  focusSelection?: () => void;
  revealSelection?: (selection: Selection) => void;
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
  const session = initial.session;
  let detach: (() => void) | undefined;

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

  const view = {
    get isDestroyed() {
      return destroyed;
    },
    update(next: BrowserViewOptions) {
      if (destroyed) throw new Error('Editor view is destroyed');

      if (next.session !== session)
        throw new Error('A mounted view cannot change its editor session');
      options = next;
    },
    focus() {
      if (destroyed) return;

      if (options.focusSelection) options.focusSelection();
      else options.pointer.focus();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      detach?.();
      pointer.onPointerCancel();

      for (const dispose of cleanup) dispose();
    },
  };

  try {
    if (session)
      detach = connectEditorView(session, {
        focus: () => view.focus(),
        reveal: (selection) => options.revealSelection?.(selection),
        destroy: () => view.destroy(),
      });
  } catch (error) {
    view.destroy();
    throw error;
  }

  return view;
}

export { createTextInteraction, positionTextInput } from './text-interaction';

export { hitTestTextLines, type TextHit, type TextHitRegion } from './hit-testing';

export {
  createTextNavigation,
  type NavigationBlock,
  type NavigationLayout,
  type NavigationKey,
} from './keyboard-navigation';

export { textSelectionAtClick } from './selection-view';

export { textBoundaryNearNode, moveNodeSelection, type NavigationNode } from './node-navigation';

export { inputPolicies, type InputContribution, type ViewSession } from './input-contributions';

export {
  viewLayers,
  type ViewLayerContribution,
  type ViewLayerFrame,
  type LayerBlock,
} from './view-layers';
