import type { NodeIdentity, RelativePosition, TextPoint } from '@gprose/model';

import { allocatedBlockWidth } from '../editor-browser/block-geometry';
import type { ViewSession } from '../editor-browser/input-contributions';
import type { NodeView } from '../editor-browser/node-views';
import type { DocumentLayoutFrame, DocumentLayoutSnapshot } from './document-layout';
import type { createDocumentPresentation } from './presentation';
import { readRevealOptions, type RevealOptions } from './view-options';

type Document<N extends NodeIdentity> = ReturnType<
  ReturnType<typeof createDocumentPresentation<N>>['query']
>;

type GeometryFrame<N extends NodeIdentity> = {
  document: Document<N>;
  layout: DocumentLayoutSnapshot<N>;
  viewport: DocumentLayoutFrame<N>['viewport'];
};

/** All lengths are unscaled document units. Client coordinates are provided by coordsAt. */
export type ViewSnapshot = Readonly<{
  version: number;
  documentRevision: number;
  zoom: number;
  viewport: Readonly<{ top: number; width: number; height: number }>;
  content: Readonly<{ left: number; width: number; height: number }>;
}>;

export type BlockBounds = Readonly<{
  id: number;
  left: number;
  top: number;
  width: number;
  height: number;
}>;

/** Owns asynchronous text reveal and the mapping from resident layout to client coordinates. */
export function createViewGeometry<N extends NodeIdentity>({
  editor,
  bounds,
  nodeView,
  invalidate,
  onError,
}: {
  editor: ViewSession<N>;
  bounds: () => DOMRect;
  nodeView: (id: number) => NodeView<N> | undefined;
  invalidate: () => void;
  onError: (error: Error) => void;
}) {
  let frame: GeometryFrame<N> | undefined;
  let snapshot: ViewSnapshot | null = null;
  let version = 0;
  const listeners = new Set<() => void>();
  let notificationQueued = false;
  let scheduled: number | undefined;
  let destroyed = false;

  let pending:
    | {
        anchor: RelativePosition;
        options: ReturnType<typeof readRevealOptions>;
        resolve: (visible: boolean) => void;
      }
    | undefined;

  function notify() {
    if (notificationQueued) return;
    notificationQueued = true;
    // Observers may update or destroy the view. Finish native reconciliation
    // before invoking them, and coalesce intermediate synchronous snapshots.
    queueMicrotask(() => {
      notificationQueued = false;
      const published = snapshot;
      const observers = [...listeners];

      for (const listener of observers) {
        if (snapshot !== published) break;

        if (!listeners.has(listener)) continue;

        try {
          listener();
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      }

      if (destroyed && published === null) listeners.clear();
    });
  }

  function blockBounds(
    id: number,
    coordinates: 'document' | 'client' = 'document',
  ): BlockBounds | null {
    if (destroyed || !frame || frame.document.editorState.nodes !== editor.state.nodes) return null;
    const span = frame.document.spanFor(id);

    if (!span) return null;
    const { scene, inset, contentWidth } = frame.layout;
    const flow = scene.flows.get(span.node.id);
    const first = scene.placements[span.from];
    const last = scene.placements[span.to - 1];

    if (!flow && (!first || !last || span.from === span.to)) return null;
    const inherited = frame.document.projection.decorations.get(span.node.id);
    const top = flow?.bounds.top ?? first.y;
    const height = flow?.bounds.height ?? last.y + last.height - top;
    const left = inset + (flow?.bounds.left ?? inherited?.inset ?? 0);

    const width =
      flow?.bounds.width ??
      allocatedBlockWidth(contentWidth, inherited?.inset ?? 0, inherited?.endInset ?? 0);

    if (coordinates === 'client') {
      const canvas = bounds();
      const { zoom, readScroll } = frame.viewport;

      return {
        id: span.node.id,
        left: canvas.left + left * zoom,
        top: canvas.top + top * zoom - readScroll(),
        width: width * zoom,
        height: height * zoom,
      };
    }

    return { id: span.node.id, left, top, width, height };
  }

  function coordsAt(point: TextPoint): DOMRect | null {
    if (destroyed || !frame || frame.document.editorState.nodes !== editor.state.nodes) return null;
    const node = frame.document.tree.byId.get(point.id)?.node;
    const text = node && editor.schema.text(node);

    if (
      text == null ||
      !Number.isSafeInteger(point.offset) ||
      point.offset < 0 ||
      point.offset > text.length
    )
      return null;
    const owner = frame.document.blockFor(point.id);

    if (!owner) return null;
    const native = nodeView(owner.id)?.coordsAt?.(point);

    if (native) return native;

    // A rendered container owns its descendants; their offsets are not its own text offsets.
    if (owner.id !== point.id) return null;
    const index = frame.document.nodeIndexes.get(owner.id);
    const placement = index === undefined ? undefined : frame.layout.scene.placements[index];

    if (!placement?.layout) return null;
    const rect = placement.layout.geometry(point.offset, point.offset, false).caret;
    const canvas = bounds();
    const { zoom, readScroll } = frame.viewport;

    return new DOMRect(
      canvas.left + (frame.layout.inset + rect[0]) * zoom,
      canvas.top + (placement.y + rect[1]) * zoom - readScroll(),
      (rect[2] - rect[0]) * zoom,
      (rect[3] - rect[1]) * zoom,
    );
  }

  function target() {
    if (!pending) return null;
    const result = editor.positions.resolve(pending.anchor);

    return result.status === 'resolved' ? result.point : null;
  }

  function finish(visible: boolean) {
    const request = pending;
    pending = undefined;
    request?.resolve(visible);

    if (!destroyed) invalidate();
  }

  function schedule() {
    if (destroyed || !pending || scheduled !== undefined) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = undefined;

      try {
        const point = target();
        const options = pending?.options;

        if (!point || !options) return finish(false);

        if (!frame || frame.document.editorState.nodes !== editor.state.nodes) return;
        const owner = frame.document.blockFor(point.id);

        if (owner) nodeView(owner.id)?.reveal?.(point);
        const rect = coordsAt(point);

        if (!rect) return finish(false);
        const canvas = bounds();
        const { readScroll, scrollDocumentTo, viewportHeight } = frame.viewport;
        const margin = Math.min(options.margin, Math.max(0, (viewportHeight - rect.height) / 2));
        const top = canvas.top + margin;
        const bottom = canvas.top + viewportHeight - margin;

        const delta =
          options.align === 'start'
            ? rect.top - top
            : options.align === 'center'
              ? (rect.top + rect.bottom - top - bottom) / 2
              : options.align === 'end'
                ? rect.bottom - bottom
                : rect.top < top
                  ? rect.top - top
                  : rect.bottom > bottom
                    ? rect.bottom - bottom
                    : 0;

        if (Math.abs(delta) < 1) return finish(true);
        const before = readScroll();
        scrollDocumentTo(Math.max(0, before + delta));

        // A document edge can prevent the requested alignment even when the
        // target is visible. Report visibility rather than retrying forever.
        if (Math.abs(readScroll() - before) < 0.1)
          return finish(
            rect.top >= canvas.top - 1 && rect.bottom <= canvas.top + viewportHeight + 1,
          );
        invalidate();
        schedule();
      } catch (error) {
        pending?.resolve(false);
        pending = undefined;
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  return {
    isCurrent: () => !destroyed && frame?.document.editorState.nodes === editor.state.nodes,
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      if (destroyed) throw new Error('Editor view is destroyed');
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    blockBounds,
    coordsAt,
    /** Reveal without changing focus or selection. A later request supersedes an earlier one. */
    reveal(this: void, point: TextPoint, options: RevealOptions = {}): Promise<boolean> {
      if (destroyed) return Promise.resolve(false);
      const resolvedOptions = readRevealOptions(options);
      const anchor = editor.positions.at(point.id, point.offset);
      pending?.resolve(false);

      return new Promise<boolean>((resolve) => {
        pending = { anchor, options: resolvedOptions, resolve };

        try {
          invalidate();
          schedule();
        } catch (error) {
          pending = undefined;
          resolve(false);
          onError(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    pinned(): readonly number[] {
      const point = target();

      return point ? [point.id] : [];
    },
    update(value: GeometryFrame<N>) {
      if (destroyed) return;
      const { zoom, width, viewportHeight, readScroll } = value.viewport;
      const top = readScroll() / zoom;
      const previous = frame;
      frame = value;
      schedule();

      if (
        previous?.layout === value.layout &&
        previous.document.editorState === value.document.editorState &&
        snapshot?.zoom === zoom &&
        snapshot.viewport.top === top &&
        snapshot.viewport.width === width / zoom &&
        snapshot.viewport.height === viewportHeight / zoom
      )
        return;
      snapshot = Object.freeze({
        version: ++version,
        documentRevision: value.document.editorState.revision,
        zoom,
        viewport: Object.freeze({ top, width: width / zoom, height: viewportHeight / zoom }),
        content: Object.freeze({
          left: value.layout.inset,
          width: value.layout.contentWidth,
          height: value.layout.scene.height,
        }),
      });
      notify();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;

      if (scheduled !== undefined) cancelAnimationFrame(scheduled);
      finish(false);
      frame = undefined;
      snapshot = null;
      notify();
    },
  };
}
