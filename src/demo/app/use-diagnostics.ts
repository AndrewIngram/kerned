import { type CanvasKit } from 'canvaskit-wasm';
import { useEffect, type RefObject } from 'react';

import type { CanvasDiagnostics } from '../../editor-canvas/canvas-renderer';
import { benchmarkContainerEdits, checkContainers } from '../../editor-container-checks';
import { checkExtensions } from '../../editor-extension-checks';
import { checkReflow } from '../../editor-reflow-checks';
import { checkSelections } from '../../editor-selection-checks';
import { checkTransactions } from '../../editor-transaction-checks';
import { commentDecorations, createCommentStore } from '../../extensions/comment';
import type { StarterLeaf } from '../../extensions/demo-model';
import { demoSchema } from '../../extensions/demo-schema';
import { importHtml } from '../../extensions/html';
import type { DocumentLayout } from '../../extensions/starter-kit/document-layout';
import type { EditorSession, Owned } from '../../extensions/starter-kit/types';
import { parseAnchor } from '../../model';
import { checkInline } from '../../owned-inline-checks';
import {
  type FindState,
  createAnchor,
  resolveAnchor,
  resolveRangeDecorations,
  TextSelection,
  RangeSelection,
  textSelection,
  type Selection,
} from '../../state';
import type { StreamState } from './use-sample-stream';

type DiagnosticsOptions = {
  editor: EditorSession;
  comments: ReturnType<typeof createCommentStore<{ body: string; reply: string }>>;
  findRef: RefObject<FindState>;
  kit: CanvasKit;
  current: RefObject<{ nodes: StarterLeaf[]; selection: Selection; width: number }>;
  layoutDiagnostics: DocumentLayout['diagnostics'];
  paused: StreamState['paused'];
  metrics: StreamState['metrics'];
  owned: Owned;
  readScroll: () => number;
  zoom: number;
  scrollDocumentTo: (top: number) => void;
  canvasDiagnostics: CanvasDiagnostics;
  setSelection: (selection: Selection) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

export function useDiagnostics({
  editor,
  comments,
  findRef,
  kit,
  current,
  layoutDiagnostics,
  paused,
  metrics,
  owned,
  readScroll,
  zoom,
  scrollDocumentTo,
  canvasDiagnostics,
  setSelection,
  inputRef,
}: DiagnosticsOptions) {
  useEffect(() => {
    const diagnostics = {
      anchor: (id: number, offset: number, bias: -1 | 1) =>
        createAnchor(demoSchema, editor.state, 'editor-demo', id, offset, bias),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- External serialized anchors are parsed at this diagnostics boundary.
      resolveAnchor: (value: unknown) =>
        resolveAnchor(demoSchema, parseAnchor(value), 'editor-demo', editor.state, editor.journal),
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
        checkReflow(
          kit,
          current.current.nodes,
          layoutDiagnostics.scene,
          layoutDiagnostics.measurements,
        ),
      pause: () => {
        paused.current = true;
      },
      resume: () => {
        paused.current = false;
      },
      metrics: () => ({
        ...metrics.current,
        cachedParagraphs: layoutDiagnostics.cachedParagraphs,
        residentParagraphs: layoutDiagnostics.residentParagraphs,
        retention: owned.retention(),
        memory: owned.memory(),
      }),
      probe: (ids: number[]) => ({
        reflowPending: layoutDiagnostics.scene.pending,
        generation: layoutDiagnostics.scene.generation,
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
        width: layoutDiagnostics.contentWidth,
        mounted: [...document.querySelectorAll('[data-editor-node]')].map((n) =>
          Number(n.getAttribute('data-editor-node')),
        ),
        nodes: current.current.nodes.filter((n) => ids.includes(n.id)),
        scene: layoutDiagnostics.scene.placements
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
        const p = layoutDiagnostics.scene.placements.find((p) => p.node.id === id);

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
        scene: layoutDiagnostics.scene.placements.map((p) => ({
          id: p.node.id,
          y: p.y,
          height: p.height,
          layoutWidth: p.layoutWidth,
          boxes: p.boxes,
        })),
        stats: { ...owned.stats },
        mounted: [...document.querySelectorAll('[data-editor-node]')].map((n) =>
          n.getAttribute('data-editor-node'),
        ),
        zoom,
        width: layoutDiagnostics.contentWidth,
        scroll: readScroll(),
        paintCount: canvasDiagnostics.painterCount,
      }),
      select: (id: number, index: number) => {
        setSelection(textSelection(id, index));
        inputRef.current?.focus({ preventScroll: true });
      },
    };

    const host: Window & { editorDiagnostics?: typeof diagnostics } = window;
    host.editorDiagnostics = diagnostics;

    return () => {
      if (host.editorDiagnostics === diagnostics) delete host.editorDiagnostics;
    };
  }, [
    owned,
    zoom,
    editor,
    comments,
    kit,
    current,
    layoutDiagnostics,
    paused,
    metrics,
    readScroll,
    canvasDiagnostics,
    findRef,
    scrollDocumentTo,
    setSelection,
    inputRef,
  ]);
}
