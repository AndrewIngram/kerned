import { type CanvasKit } from 'canvaskit-wasm';
import { useEffect } from 'react';
import type { FindState } from '../../editor';
import {
  createAnchor,
  parseAnchor,
  resolveAnchor,
  resolveRangeDecorations,
  TextSelection,
  RangeSelection,
  textSelection,
  type Selection,
} from '../../editor';
import { benchmarkContainerEdits, checkContainers } from '../../editor-container-checks';
import { checkExtensions } from '../../editor-extension-checks';
import { type CanvasPaintLayer, type CanvasPainter as Painter } from '../../editor-react';
import { checkSelections } from '../../editor-selection-checks';
import { commentDecorations, createCommentStore } from '../../extensions/comment';
import type { HybridLeaf } from '../../extensions/demo-model';
import { demoSchema } from '../../extensions/demo-schema';
import { importHtml } from '../../extensions/html';
import { checkReflow } from '../../hybrid-reflow-checks';
import { createHybridScene, type Scene } from '../../hybrid-scene';
import { checkTransactions } from '../../hybrid-transaction-checks';
import { checkInline } from '../../owned-inline-checks';

import type { RefObject } from 'react';
import type { EditorSession, Owned } from '../../extensions/starter-kit/types';
import type { StreamState } from './use-sample-stream';

type DiagnosticsOptions = {
  editor: EditorSession;
  comments: ReturnType<typeof createCommentStore<{ body: string; reply: string }>>;
  findRef: RefObject<FindState>;
  kit: CanvasKit;
  current: RefObject<{ nodes: HybridLeaf[]; selection: Selection; width: number }>;
  sceneRef: RefObject<Scene>;
  measurementsRef: RefObject<Map<number, { width: number; height: number }>>;
  paused: StreamState['paused'];
  metrics: StreamState['metrics'];
  sceneCache: ReturnType<typeof createHybridScene>;
  owned: Owned;
  readScroll: () => number;
  zoom: number;
  widthRef: RefObject<number>;
  scrollDocumentTo: (top: number) => void;
  painters: RefObject<Map<string, { paint: Painter; layer: CanvasPaintLayer }>>;
  setSelection: (selection: Selection) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

export function useDiagnostics({
  editor,
  comments,
  findRef,
  kit,
  current,
  sceneRef,
  measurementsRef,
  paused,
  metrics,
  sceneCache,
  owned,
  readScroll,
  zoom,
  widthRef,
  scrollDocumentTo,
  painters,
  setSelection,
  inputRef,
}: DiagnosticsOptions) {
  useEffect(() => {
    const diagnostics = {
      anchor: (id: number, offset: number, bias: -1 | 1) =>
        createAnchor(demoSchema, editor.state, 'hybrid-demo', id, offset, bias),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- External serialized anchors are parsed at this diagnostics boundary.
      resolveAnchor: (value: unknown) =>
        resolveAnchor(demoSchema, parseAnchor(value), 'hybrid-demo', editor.state, editor.journal),
      comments: () => ({
        threads: comments.state.threads,
        ...resolveRangeDecorations(commentDecorations(comments.state.threads), editor.positions),
        revision: editor.state.revision,
      }),
      history: () => editor.history,
      find: () => findRef.current,
      checkTransactions,
      checkExtensions,
      checkContainers,
      checkSelections,
      benchmarkContainerEdits,
      importHtml,
      verifyReflow: () =>
        checkReflow(kit, current.current.nodes, sceneRef.current, measurementsRef.current),
      pause: () => {
        paused.current = true;
      },
      resume: () => {
        paused.current = false;
      },
      metrics: () => ({
        ...metrics.current,
        cachedParagraphs: sceneCache.cachedParagraphs,
        residentParagraphs: sceneCache.residentParagraphs,
        retention: owned.retention(),
        memory: owned.memory(),
      }),
      probe: (ids: number[]) => ({
        reflowPending: sceneRef.current.pending,
        generation: sceneRef.current.generation,
        stalePaints: metrics.current.stalePaints,
        count: current.current.nodes.length,
        selection:
          current.current.selection instanceof TextSelection
            ? {
                id: current.current.selection.head.id,
                anchorId: current.current.selection.anchor.id,
                anchor: current.current.selection.anchor.offset,
                focus: current.current.selection.head.offset,
                upstream: current.current.selection.upstream,
              }
            : current.current.selection instanceof RangeSelection
              ? {
                  type: 'range',
                  anchor: current.current.selection.anchor,
                  head: current.current.selection.head,
                }
              : { type: current.current.selection.type },
        stats: { ...owned.stats },
        paused: paused.current,
        complete: !!metrics.current.completedAt,
        scroll: readScroll(),
        zoom,
        width: widthRef.current,
        mounted: [...document.querySelectorAll('[data-widget], [data-image]')].map((n) =>
          Number(n.getAttribute('data-widget') ?? n.getAttribute('data-image')),
        ),
        nodes: current.current.nodes.filter((n) => ids.includes(n.id)),
        scene: sceneRef.current.placements
          .filter((p) => ids.includes(p.node.id))
          .map((p) => ({
            id: p.node.id,
            y: p.y,
            height: p.height,
            layoutWidth: p.layoutWidth,
            boxes: p.boxes,
          })),
        layoutCalls: metrics.current.layoutCalls,
        lastLayoutIds: metrics.current.lastLayoutIds,
      }),
      scrollTo: (id: number, offset = 0) => {
        const p = sceneRef.current.placements.find((p) => p.node.id === id);

        if (p) scrollDocumentTo((p.y + offset) * zoom);
      },
      checkInline: () => checkInline(owned),
      read: () => ({
        nodes: current.current.nodes,
        selection:
          current.current.selection instanceof TextSelection
            ? {
                id: current.current.selection.head.id,
                anchorId: current.current.selection.anchor.id,
                anchor: current.current.selection.anchor.offset,
                focus: current.current.selection.head.offset,
                upstream: current.current.selection.upstream,
              }
            : current.current.selection instanceof RangeSelection
              ? {
                  type: 'range',
                  anchor: current.current.selection.anchor,
                  head: current.current.selection.head,
                }
              : { type: current.current.selection.type },
        scene: sceneRef.current.placements.map((p) => ({
          id: p.node.id,
          y: p.y,
          height: p.height,
          layoutWidth: p.layoutWidth,
          boxes: p.boxes,
        })),
        stats: { ...owned.stats },
        mounted: [...document.querySelectorAll('[data-widget]')].map((n) =>
          n.getAttribute('data-widget'),
        ),
        zoom,
        width: widthRef.current,
        scroll: readScroll(),
        paintCount: painters.current.size,
      }),
      select: (id: number, index: number) => {
        setSelection(textSelection(id, index));
        inputRef.current?.focus({ preventScroll: true });
      },
    };

    const host: Window & { hybridSpike?: typeof diagnostics } = window;
    host.hybridSpike = diagnostics;

    return () => {
      if (host.hybridSpike === diagnostics) delete host.hybridSpike;
    };
  }, [owned, zoom]);
}
