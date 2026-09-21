import type { createDocumentQuery } from '../editor-browser/document';
import type { Rect } from '../engines';
import type { NodeIdentity } from '../model';
import { RangeSelection } from '../state';
import {
  createEditorScene,
  type Measurement,
  type Placement,
  type Scene,
  type PresentBlock,
} from './scene';

type LayoutResult<N extends NodeIdentity> = ReturnType<
  ReturnType<typeof createEditorScene<N>>['build']
>;

type LayoutDocument<N extends NodeIdentity> = Pick<
  ReturnType<ReturnType<typeof createDocumentQuery<N, N, { inset: number }>>>,
  | 'nodes'
  | 'nodeIndexes'
  | 'projection'
  | 'textSelection'
  | 'focusId'
  | 'selection'
  | 'collapsed'
  | 'blockFor'
>;

export type DocumentLayoutSource<N extends NodeIdentity> = {
  getSnapshot(this: void): LayoutDocument<N>;
  subscribe(this: void, listener: () => void): () => void;
};

export type DocumentLayoutFrame<N extends NodeIdentity = NodeIdentity> = {
  viewport: {
    width: number;
    zoom: number;
    viewportHeight: number;
    readScroll: () => number;
    scrollDocumentTo: (top: number) => void;
  };
  pinned: readonly number[];
  paddingTop: number;
  presentationVersion?: number;
  eager: boolean;
  retainAll: boolean;
  onLayout: (result: LayoutResult<N>, width: number) => void;
};

export type DocumentLayoutSnapshot<N extends NodeIdentity> = {
  nodes: readonly N[];
  inset: number;
  scene: Scene<N>;
  visible: Placement<N>[];
  top: number;
  bottom: number;
  contentWidth: number;
  activePlacement: Placement<N> | undefined;
  caret: Rect | undefined;
};

function emptySnapshot<N extends NodeIdentity>(): DocumentLayoutSnapshot<N> {
  return {
    nodes: [],
    inset: 28,
    scene: {
      placements: [],
      height: 50,
      width: 0,
      top: 0,
      zoom: 1,
      pending: 0,
      generation: 0,
      paddingTop: 0,
    },
    visible: [],
    top: 0,
    bottom: 0,
    contentWidth: 150,
    activePlacement: undefined,
    caret: undefined,
  };
}

/** Owns scene publication, measurements and background reflow for one mounted document. */
export function createDocumentLayout<N extends NodeIdentity>({
  owned,
  present,
  source,
  onError,
}: {
  owned: Parameters<typeof createEditorScene>[0];
  present: PresentBlock<N>;
  source: DocumentLayoutSource<N>;
  onError?: (error: Error) => void;
}) {
  const sceneCache = createEditorScene(owned, present);
  const listeners = new Set<() => void>();
  let snapshot = emptySnapshot<N>();
  let presented = snapshot;
  let measurements = new Map<number, Measurement>();
  let frame: DocumentLayoutFrame<N> | undefined;
  let document: LayoutDocument<N> | undefined;
  let detach: (() => void) | undefined;
  let scheduled: number | 'queued' | undefined;
  let invalidated = false;
  let measured = false;
  let lastScroll = 0;
  let destroyed = false;

  function assertAlive() {
    if (destroyed) throw new Error('Document layout has been destroyed');
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function schedule() {
    if (!detach || scheduled !== undefined || (!measured && !snapshot.scene.pending)) return;
    const attachment = detach;
    scheduled = 'queued';
    // Give the host's paint submission priority over background composition.
    queueMicrotask(() => {
      if (detach !== attachment || scheduled !== 'queued') return;
      scheduled = requestAnimationFrame(() => {
        scheduled = undefined;
        backgroundBuild(true);
      });
    });
  }

  function invalidate() {
    if (!detach || invalidated) return;
    invalidated = true;
    const attachment = detach;
    // Coalesce synchronous transactions; layout does not extend their call stack.
    queueMicrotask(() => {
      if (detach !== attachment || !invalidated) return;
      backgroundBuild(false);
    });
  }

  function backgroundBuild(advance: boolean) {
    try {
      build(advance);
    } catch (error) {
      if (!onError) throw error;
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function build(advance: boolean) {
    if (!frame || !detach) return;
    invalidated = false;
    const current = frame;
    const doc = source.getSnapshot();

    if (document?.nodes !== doc.nodes) {
      measurements = new Map([...measurements].filter(([id]) => doc.nodeIndexes.has(id)));
    }

    document = doc;
    const { viewport } = current;
    const { zoom, viewportHeight, readScroll } = viewport;
    const { nodes, projection, textSelection: selection, focusId } = doc;

    const endpoints = selection
      ? [selection.anchor.id, selection.head.id]
      : focusId === null
        ? []
        : [focusId];

    const pinned = [
      ...new Set([...endpoints, ...current.pinned].map((id) => doc.blockFor(id)?.id ?? id)),
    ];

    const inset = 28;
    const contentWidth = Math.max(150, viewport.width / zoom - 2 * inset);
    const liveScroll = readScroll();

    // Several layouts may be published before the host commits one. Preserve
    // their pending anchor adjustment unless the user has scrolled meanwhile.
    const viewportTop =
      snapshot !== presented && liveScroll === lastScroll
        ? (snapshot.top * snapshot.scene.zoom) / zoom
        : liveScroll / zoom;

    const result = sceneCache.build(
      nodes,
      contentWidth,
      measurements,
      {
        // A queued frame can precede the scroll event delivered to the host.
        top: viewportTop,
        height: viewportHeight / zoom,
        zoom,
        paddingTop: current.paddingTop,
        presentationVersion: current.presentationVersion,
        pinned,
        advance,
        eager: current.eager,
        retainAll: current.retainAll,
      },
      projection.decorations,
    );

    const scene = result.scene;
    const activeId = focusId === null ? null : (doc.blockFor(focusId)?.id ?? focusId);
    const activePlacement = scene.placements.find((p) => p.node.id === activeId);
    const rangeHead = doc.selection instanceof RangeSelection ? doc.selection.head : null;

    const caret = selection
      ? activePlacement?.layout?.geometry(
          selection.head.offset,
          selection.head.offset,
          selection.upstream,
        ).caret
      : rangeHead?.kind === 'text'
        ? activePlacement?.layout?.geometry(
            rangeHead.offset,
            rangeHead.offset,
            doc.selection instanceof RangeSelection && doc.selection.upstream,
          ).caret
        : rangeHead?.kind === 'node' && doc.collapsed && activePlacement
          ? ([
              0,
              rangeHead.side === 'before' ? 0 : activePlacement.height,
              1,
              (rangeHead.side === 'before' ? 0 : activePlacement.height) + 16,
            ] satisfies Rect)
          : undefined;

    const top = scene.top;
    const bottom = top + viewportHeight / zoom;
    const placements = scene.placements;

    let lo = 0,
      hi = placements.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;

      if (placements[mid].y + placements[mid].height < top - 160) lo = mid + 1;
      else hi = mid;
    }

    const visible: Placement<N>[] = [];

    for (let i = lo; i < placements.length && placements[i].y < bottom + 160; i++)
      visible.push(placements[i]);

    for (const id of pinned) {
      const placement = placements.find((p) => p.node.id === id);

      if (placement && !visible.includes(placement)) visible.push(placement);
    }

    snapshot = {
      nodes: doc.nodes,
      inset,
      scene,
      visible: visible.toSorted((a, b) => a.y - b.y),
      top,
      bottom,
      contentWidth,
      activePlacement,
      caret,
    };
    measured = false;
    lastScroll = readScroll();
    current.onLayout(result, contentWidth);

    if (!destroyed && frame === current) notify();
    schedule();
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
    attach() {
      assertAlive();

      if (detach) throw new Error('Document layout is already attached');

      const unsubscribe = source.subscribe(invalidate);

      const release = () => {
        if (detach !== release) return;
        detach = undefined;
        unsubscribe();

        if (scheduled !== undefined && scheduled !== 'queued') cancelAnimationFrame(scheduled);
        scheduled = undefined;
        invalidated = false;
        frame = undefined;
        document = undefined;
        measurements = new Map();
        measured = false;
        sceneCache.clear();
        snapshot = emptySnapshot<N>();
        presented = snapshot;
        lastScroll = 0;
        notify();
      };

      detach = release;
      build(false);

      return release;
    },
    update(next: DocumentLayoutFrame<N>) {
      assertAlive();
      const previous = frame;
      frame = next;

      if (
        previous !== undefined &&
        document === source.getSnapshot() &&
        previous.viewport.width === next.viewport.width &&
        previous.viewport.zoom === next.viewport.zoom &&
        previous.viewport.viewportHeight === next.viewport.viewportHeight &&
        previous.paddingTop === next.paddingTop &&
        previous.presentationVersion === next.presentationVersion &&
        previous.pinned.length === next.pinned.length &&
        previous.pinned.every((id, index) => id === next.pinned[index]) &&
        previous.eager === next.eager &&
        previous.retainAll === next.retainAll &&
        lastScroll === next.viewport.readScroll() &&
        !measured
      )
        return;

      build(false);
    },
    replaceEngine(next: Parameters<typeof createEditorScene>[0]) {
      assertAlive();
      sceneCache.replaceEngine(next);
      build(false);
    },
    measure(this: void, id: number, width: number, height: number) {
      assertAlive();

      if (
        !frame ||
        !detach ||
        width !== snapshot.contentWidth ||
        !Number.isFinite(height) ||
        height <= 0 ||
        !document?.nodeIndexes.has(id)
      )
        return;
      const previous = measurements.get(id);

      if (previous?.width === width && previous.height === height) return;
      measurements = new Map(measurements).set(id, { width, height });
      measured = true;
      schedule();
    },
    /** The host calls this after applying the snapshot's document height to the DOM. */
    present(value: DocumentLayoutSnapshot<N>) {
      assertAlive();

      if (value !== snapshot || !frame || !detach) return;
      const { readScroll, zoom, scrollDocumentTo } = frame.viewport;

      if (readScroll() !== lastScroll) {
        build(false);

        return;
      }

      const desired = Math.max(0, snapshot.top * zoom);

      if (Math.abs(readScroll() - desired) > 0.1) {
        scrollDocumentTo(desired);
        lastScroll = readScroll();
      }

      presented = value;
    },
    layoutFor(this: void, id: number) {
      assertAlive();

      return sceneCache.layoutFor(id);
    },
    diagnostics: {
      get scene() {
        return snapshot.scene;
      },
      get contentWidth() {
        return snapshot.contentWidth;
      },
      get measurements(): ReadonlyMap<number, Measurement> {
        return measurements;
      },
      get cachedParagraphs() {
        return sceneCache.cachedParagraphs;
      },
      get residentParagraphs() {
        return sceneCache.residentParagraphs;
      },
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      detach?.();
      frame = undefined;
    },
  };
}

export type DocumentLayout<N extends NodeIdentity = NodeIdentity> = ReturnType<
  typeof createDocumentLayout<N>
>;
