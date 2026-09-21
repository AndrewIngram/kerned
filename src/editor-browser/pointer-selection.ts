import {
  type Selection,
  NodeSelection,
  TextSelection,
  extendSelection,
  selectionAnchor,
  type SelectionAnchor,
  type SelectionContext,
} from '../state';
import { type TextHit } from './hit-testing';

type MouseInput = Pick<
  MouseEvent,
  | 'defaultPrevented'
  | 'button'
  | 'target'
  | 'currentTarget'
  | 'clientX'
  | 'clientY'
  | 'shiftKey'
  | 'detail'
  | 'preventDefault'
>;

type PointerInput = MouseInput & Pick<PointerEvent, 'pointerId' | 'pointerType'>;

export type PointerSelectionOptions = {
  hitTest: (clientX: number, clientY: number) => TextHit | null;
  selection: () => Selection;
  onSelect: (selection: Selection) => void;
  focus: () => void;
  context?: () => SelectionContext | undefined;
  nodeAt?: (target: Element) => number | null;
  selectRange?: (hit: TextHit, clicks: number) => TextSelection | null;
  onStart?: (hit: TextHit, clicks: number) => void;
  onDrag?: (hit: TextHit) => void;
};

/** Spread these handlers on the entire editor surface, including its gutters.
 * Native controls and data-editor-interactive opt out. Non-atomic decorations
 * may opt back into text selection with data-editor-text-hit.
 */
export function createPointerSelection(options: PointerSelectionOptions) {
  let mouse = 0,
    drag: { pointerId: number; anchor: SelectionAnchor; x: number; y: number } | null = null;

  function begin(event: MouseInput, pointerId: number, clicks: number) {
    if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return;

    if (
      !event.target.closest('[data-editor-text-hit]') &&
      event.target.closest(
        'button,a,input,textarea,select,summary,label,[role="button"],[role="dialog"],[contenteditable="true"],[data-editor-interactive]',
      )
    )
      return;
    const node = options.nodeAt?.(event.target);
    const hit = node == null ? options.hitTest(event.clientX, event.clientY) : null;

    if (node == null && !hit) return;
    event.preventDefault();
    const current = options.selection();

    const target: SelectionAnchor | null =
      node != null
        ? { kind: 'node-selection', id: node }
        : hit
          ? { kind: 'text', ...hit.point }
          : null;

    if (!target) return;
    const context = options.context?.();
    const previous = event.shiftKey ? selectionAnchor(current) : null;
    const multi = hit ? options.selectRange?.(hit, clicks) : null;

    const next =
      multi ??
      (previous && context
        ? extendSelection(previous, target, context, hit?.upstream)
        : node != null
          ? new NodeSelection(node)
          : target.kind === 'text'
            ? new TextSelection(
                previous?.kind === 'text' ? previous : target,
                target,
                hit?.upstream,
              )
            : new NodeSelection(target.id));

    const anchor: SelectionAnchor =
      previous ?? (multi ? { kind: 'text', ...multi.anchor } : target);

    drag = { pointerId, anchor, x: event.clientX, y: event.clientY };

    if (pointerId && event.currentTarget instanceof HTMLElement)
      event.currentTarget.setPointerCapture(pointerId);
    options.onSelect(next);

    if (hit) options.onStart?.(hit, clicks);
    options.focus();
  }

  return {
    onPointerDown(this: void, event: PointerInput) {
      if (event.pointerType === 'mouse') {
        mouse = event.pointerId;

        return;
      }

      begin(event, event.pointerId, 1);
    },
    onMouseDown(this: void, event: MouseInput) {
      begin(event, mouse, event.detail);
    },
    onPointerMove(this: void, event: PointerInput) {
      const current = drag;

      if (
        !current ||
        current.pointerId !== event.pointerId ||
        Math.hypot(event.clientX - current.x, event.clientY - current.y) < 3
      )
        return;
      // Pointer capture retargets events to the editor root. Hit-test the actual
      // element under the pointer to retain atomic-node targeting during a drag.
      const element = document.elementFromPoint(event.clientX, event.clientY);

      const node =
        element && event.currentTarget instanceof Element && event.currentTarget.contains(element)
          ? options.nodeAt?.(element)
          : null;

      const hit = node == null ? options.hitTest(event.clientX, event.clientY) : null;

      if (node == null && !hit) return;
      const context = options.context?.();

      const target: SelectionAnchor | null =
        node != null
          ? { kind: 'node-selection', id: node }
          : hit
            ? { kind: 'text', ...hit.point }
            : null;

      if (context && target)
        options.onSelect(extendSelection(current.anchor, target, context, hit?.upstream));
      else if (hit && current.anchor.kind === 'text')
        options.onSelect(new TextSelection(current.anchor, hit.point, hit.upstream));

      if (hit) options.onDrag?.(hit);
    },
    onPointerUp(this: void, event: PointerInput) {
      if (drag?.pointerId !== event.pointerId) return;
      drag = null;

      if (
        event.currentTarget instanceof HTMLElement &&
        event.currentTarget.hasPointerCapture(event.pointerId)
      )
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel(this: void) {
      drag = null;
    },
    onLostPointerCapture(this: void) {
      drag = null;
    },
  };
}
