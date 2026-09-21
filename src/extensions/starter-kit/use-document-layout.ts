import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Viewport } from '../../editor-react';
import { createEditorScene, type Placement, type Scene } from '../../editor-scene';
import { RangeSelection } from '../../state';
import type { EditorDocument, Owned } from './types';

type LayoutResult = ReturnType<ReturnType<typeof createEditorScene>['build']>;

type LayoutOptions = {
  owned: Owned;
  size: number;
  document: EditorDocument;
  viewport: Viewport;
  panelId: number | undefined;
  focusedWidget: number | null;
  findBlockId: number | undefined;
  findOpen: boolean;
  eager: boolean;
  retainAll: boolean;
  onLayout: (result: LayoutResult, width: number) => void;
};

export function useDocumentLayout({
  owned,
  size,
  document: doc,
  viewport,
  panelId,
  focusedWidget,
  findBlockId,
  findOpen,
  eager,
  retainAll,
  onLayout,
}: LayoutOptions) {
  const { nodes, projection, textSelection: selection, focusId } = doc;
  const { width, zoom, scroll, readScroll, viewportHeight, scrollDocumentTo, setScroll } = viewport;
  const [reflowTick, setReflowTick] = useState(0);
  const lastReflowTick = useRef(0);
  const [sceneCache] = useState(() => createEditorScene(owned, size));

  const [measurements, setMeasurements] = useState(
    new Map<number, { width: number; height: number }>(),
  );

  const measurementsRef = useRef(measurements);
  useLayoutEffect(() => {
    measurementsRef.current = measurements;
  }, [measurements]);
  const inset = 28;
  const contentWidth = Math.max(150, width / zoom - 2 * inset);
  const widthRef = useRef(contentWidth);
  useLayoutEffect(() => {
    widthRef.current = contentWidth;
  }, [contentWidth]);

  const onMeasure = useMemo(
    () => (id: number, measuredWidth: number, height: number) => {
      if (measuredWidth !== widthRef.current || !Number.isFinite(height) || height <= 0) return;
      setMeasurements((old) => {
        const value = old.get(id);

        if (value?.width === measuredWidth && value.height === height) return old;
        const next = new Map(old);
        next.set(id, { width: measuredWidth, height });

        return next;
      });
    },
    [],
  );

  const scene = useMemo<Scene>(() => {
    // The retained scene advances once per background tick, independently of React commits.
    const advance = lastReflowTick.current !== reflowTick;
    lastReflowTick.current = reflowTick;

    // A background tick can precede the scroll event that updates React state.
    const result = sceneCache.build(
      nodes,
      contentWidth,
      measurements,
      {
        top: readScroll() / zoom,
        height: viewportHeight / zoom,
        zoom,
        paddingTop: findOpen ? 56 / zoom : 0,
        pinned: [
          ...(selection
            ? [selection.anchor.id, selection.head.id]
            : focusId === null
              ? []
              : [focusId]),
          ...(findBlockId === undefined ? [] : [findBlockId]),
          ...(panelId === undefined ? [] : [panelId]),
          ...(focusedWidget === null ? [] : [focusedWidget]),
        ],
        advance,
        eager: eager,
        retainAll: retainAll,
      },
      projection.decorations,
    );

    onLayout(result, contentWidth);

    return result.scene;
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Scroll state invalidates the scene built from the live DOM scroll position.
  }, [
    nodes,
    contentWidth,
    measurements,
    sceneCache,
    scroll,
    zoom,
    viewportHeight,
    reflowTick,
    selection,
    eager,
    retainAll,
    onLayout,
    readScroll,
    projection.decorations,
    focusId,
    panelId,
    focusedWidget,
    findBlockId,
    findOpen,
  ]);

  const sceneRef = useRef(scene);
  useLayoutEffect(() => {
    sceneRef.current = scene;
  }, [scene]);
  const activePlacement = scene.placements.find((p) => p.node.id === focusId);

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
          ] satisfies [number, number, number, number])
        : undefined;

  useLayoutEffect(() => {
    const desired = Math.max(0, scene.top * zoom);

    if (Math.abs(readScroll() - desired) > 0.1) {
      scrollDocumentTo(desired);
      setScroll(readScroll());
    }
  }, [scene, zoom, readScroll, scrollDocumentTo, setScroll]);

  const top = scene.top,
    bottom = top + viewportHeight / zoom;

  const visible = useMemo(() => {
    const p = scene.placements;

    let lo = 0,
      hi = p.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;

      if (p[mid].y + p[mid].height < top - 160) lo = mid + 1;
      else hi = mid;
    }

    const result: Placement[] = [];

    for (let i = lo; i < p.length && p[i].y < bottom + 160; i++) result.push(p[i]);

    for (const id of [focusedWidget, panelId, findBlockId]) {
      const pinned = p.find((pValue) => pValue.node.id === id);

      if (pinned && !result.includes(pinned)) result.push(pinned);
    }

    return result.toSorted((a, b) => a.y - b.y);
  }, [scene, top, bottom, focusedWidget, panelId, findBlockId]);

  useEffect(() => {
    if (!scene.pending) return undefined;
    const frame = requestAnimationFrame(() => setReflowTick((t) => t + 1));

    return () => cancelAnimationFrame(frame);
  }, [scene, reflowTick]);
  useEffect(
    () => () => {
      sceneCache.clear();
      owned.engine.clear();
    },
    [owned, sceneCache],
  );

  return {
    inset,
    scene,
    sceneRef,
    sceneCache,
    visible,
    top,
    bottom,
    contentWidth,
    widthRef,
    measurementsRef,
    onMeasure,
    activePlacement,
    caret,
  };
}
