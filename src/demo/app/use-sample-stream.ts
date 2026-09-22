import type { ViewDiagnostics, DiagnosticEvent } from '@gprose/view/diagnostics';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { type EditorSample } from '../../editor-samples';
import { createStreamMetrics, streamConfig } from '../../editor-stream';
import type { StarterNode } from '../demo-model.js';
import type { EditorSession } from '../editor-types.js';

export function useSampleStream(
  editor: EditorSession,
  sample: EditorSample,
  seedComments: (nodes: readonly StarterNode[]) => void,
  diagnostics: ViewDiagnostics,
  ready: boolean,
  editStarted: RefObject<number | null>,
) {
  const sourceLoaded = useRef(sample.initial.length),
    sourceRevision = useRef(0);

  const [loadedCount, setLoadedCount] = useState(sample.initial.length);

  const metrics = useRef(createStreamMetrics());
  const paused = useRef(streamConfig.paused);

  const pending = useRef<{
    target: number;
    count: number;
    started: number;
    generationMs: number;
    renderMs: number;
    layouts: number;
    compositionMs: number;
    done: (work: number) => void;
  } | null>(null);

  const renderWork = useRef(0);
  useEffect(() => {
    if (!ready) return undefined;

    let cancelled = false,
      raf = 0,
      last = performance.now();

    function sampleFrame(now: number) {
      if (!metrics.current.completedAt && metrics.current.frames.length < 30000)
        metrics.current.frames.push({ at: now, gapMs: now - last });
      last = now;

      if (!metrics.current.completedAt && metrics.current.frames.length < 30000)
        raf = requestAnimationFrame(sampleFrame);
    }

    if (sample.total) raf = requestAnimationFrame(sampleFrame);

    async function load() {
      if (!sample.total) return;
      // First paint is usable before producing the next chunk.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      let cursor = sample.initial.length,
        batch = 32;

      // oxlint-disable-next-line eslint/no-unmodified-loop-condition -- Effect cleanup cancels the stream while its awaited work yields.
      while (cursor < sample.total && !cancelled) {
        // oxlint-disable-next-line eslint/no-unmodified-loop-condition -- Effect cleanup cancels the stream while its awaited work yields.
        while (paused.current && !cancelled)
          // oxlint-disable-next-line eslint/no-await-in-loop -- Stream batches and pause checks must run sequentially with rendering backpressure.
          await new Promise((resolve) => setTimeout(resolve, 16));

        if (cancelled) return;

        const count = Math.min(batch, sample.total - cursor),
          started = performance.now();

        const chunk = sample.chunk(cursor, count),
          generationMs = performance.now() - started;

        // oxlint-disable-next-line eslint/no-await-in-loop -- Stream batches and pause checks must run sequentially with rendering backpressure.
        const layoutWork = await new Promise<number>((done) => {
          const result = editor.dispatch({
            baseRevision: editor.state.revision,
            origin: 'stream',
            history: 'exclude',
            steps: [{ kind: 'append', nodes: chunk }],
          });

          sourceLoaded.current = cursor + count;
          setLoadedCount(cursor + count);
          sourceRevision.current = result.state.revision;
          pending.current = {
            target: result.state.revision,
            count,
            started,
            generationMs,
            renderMs: 0,
            layouts: metrics.current.layoutCalls,
            compositionMs: metrics.current.compositionMs,
            done,
          };
          seedComments(chunk);
        });

        cursor += count;
        // Only new paragraph composition scales with batch size. Including the
        // growing document's bookkeeping here shrank batches to eight nodes,
        // multiplying that same bookkeeping across thousands of frames.
        batch = Math.max(
          8,
          Math.min(
            128,
            Math.floor(count * Math.max(0.5, Math.min(2, 8 / Math.max(0.1, layoutWork)))),
          ),
        );
        // oxlint-disable-next-line eslint/no-await-in-loop -- Stream batches and pause checks must run sequentially with rendering backpressure.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    void load();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      pending.current?.done(0);
      pending.current = null;
    };
  }, [sample, editor, seedComments, ready]);

  useLayoutEffect(
    () =>
      diagnostics.subscribe((event) => {
        if (event.type === 'layout') recordSampleLayout(metrics, event);
        else
          recordSamplePaint({
            stream: { metrics, pending, sourceLoaded, sourceRevision },
            report: event,
            editStarted,
            total: sample.total,
          });
      }),
    [diagnostics, editStarted, sample.total],
  );

  function recordRender(elapsed: number) {
    renderWork.current = elapsed;

    if (pending.current) pending.current.renderMs += elapsed;
  }

  return {
    loadedCount,
    sourceLoaded,
    sourceRevision,
    metrics,
    paused,
    pending,
    renderWork,
    recordRender,
  };
}

export type StreamState = ReturnType<typeof useSampleStream>;

export function recordSamplePaint({
  stream,
  report,
  editStarted,
  total,
}: {
  stream: Pick<StreamState, 'metrics' | 'pending' | 'sourceLoaded' | 'sourceRevision'>;
  report: Extract<DiagnosticEvent, { type: 'paint' }>;
  editStarted: RefObject<number | null>;
  total: number;
}) {
  const { metrics, pending, sourceLoaded, sourceRevision } = stream;

  const { at: now, duration: drawMs, submitted, blocks: loaded, revision } = report,
    m = metrics.current;

  if (m.paints.length < 10000) m.paints.push(drawMs);
  m.maxMounted = Math.max(m.maxMounted, report.mounted);
  m.maxSubmitted = Math.max(m.maxSubmitted, submitted);
  const reflow = metrics.current.reflows.at(-1);

  if (reflow && reflow.generation === report.generation) {
    if (!reflow.firstPaintMs) reflow.firstPaintMs = now - reflow.started;

    if (!report.pending && !reflow.completeMs) reflow.completeMs = now - reflow.started;
  }

  if (report.stale) m.stalePaints++;

  if (editStarted.current !== null) {
    m.editPaintMs.push(now - editStarted.current);
    editStarted.current = null;
  }

  if (!m.firstCanvasFlushMs) {
    m.firstCanvasFlushMs = now;
    m.firstLoaded = loaded;
  }

  const batch = pending.current;

  if (batch && revision >= batch.target) {
    const work = batch.renderMs + drawMs + batch.generationMs;
    m.samples.push({
      loaded: loaded,
      count: batch.count,
      workMs: work,
      elapsedMs: now - batch.started,
      layouts: m.layoutCalls - batch.layouts,
    });
    pending.current = null;
    batch.done(m.compositionMs - batch.compositionMs);
  }

  if (
    total &&
    sourceLoaded.current === total &&
    revision >= sourceRevision.current &&
    !m.completedAt
  )
    m.completedAt = now;
}

export function recordSampleLayout(
  metrics: StreamState['metrics'],
  report: Extract<DiagnosticEvent, { type: 'layout' }>,
) {
  metrics.current.layoutCalls += report.layoutIds.length;
  metrics.current.compositionMs += report.compositionMs;
  metrics.current.lastLayoutIds = [...report.layoutIds];
  metrics.current.lastSceneMs = report.duration;

  if (report.reflow) {
    metrics.current.widthChanges.push({ blocks: report.blocks, workMs: report.duration });
    metrics.current.reflows.push({
      generation: report.generation,
      width: report.width,
      blocks: report.blocks,
      started: report.at - report.duration,
      firstPaintMs: 0,
      completeMs: 0,
      initialLayouts: report.layoutIds.length,
      batches: [],
    });
  }

  const run = metrics.current.reflows.at(-1);

  if (run && report.layoutIds.length)
    run.batches.push({
      workMs: report.duration,
      layouts: report.layoutIds.length,
      background: report.background,
      pending: report.pending,
    });
}
