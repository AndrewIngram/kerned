import type { ViewSession } from '../editor-browser/input-contributions';
import type { NodeView } from '../editor-browser/node-views';
import type { NodeIdentity, RelativePosition, TextPoint } from '../model';
import type { DocumentLayoutFrame, DocumentLayoutSnapshot } from './document-layout';
import type { createDocumentPresentation } from './presentation';

type Document<N extends NodeIdentity> = ReturnType<
  ReturnType<typeof createDocumentPresentation<N>>['query']
>;

type GeometryFrame<N extends NodeIdentity> = {
  document: Document<N>;
  layout: DocumentLayoutSnapshot<N>;
  viewport: DocumentLayoutFrame<N>['viewport'];
};

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
  let scheduled: number | undefined;
  let destroyed = false;
  let pending: { anchor: RelativePosition; resolve: (visible: boolean) => void } | undefined;

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

        if (!point) return finish(false);

        if (!frame || frame.document.editorState.nodes !== editor.state.nodes) return;
        const owner = frame.document.blockFor(point.id);

        if (owner) nodeView(owner.id)?.reveal?.(point);
        const rect = coordsAt(point);

        if (!rect) return finish(false);
        const canvas = bounds();
        const { readScroll, scrollDocumentTo, viewportHeight } = frame.viewport;
        const top = canvas.top;
        const bottom = top + viewportHeight;

        const delta =
          rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;

        if (Math.abs(delta) < 1) return finish(true);
        const before = readScroll();
        scrollDocumentTo(Math.max(0, before + delta));

        if (Math.abs(readScroll() - before) < 0.1) return finish(false);
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
    coordsAt,
    /** Reveal without changing focus or selection. A later request supersedes an earlier one. */
    reveal(this: void, point: TextPoint): Promise<boolean> {
      if (destroyed) return Promise.resolve(false);
      const anchor = editor.positions.at(point.id, point.offset);
      pending?.resolve(false);

      return new Promise<boolean>((resolve) => {
        pending = { anchor, resolve };

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
      frame = value;
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;

      if (scheduled !== undefined) cancelAnimationFrame(scheduled);
      finish(false);
      frame = undefined;
    },
  };
}
