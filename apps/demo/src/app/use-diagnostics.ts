import { commentDecorations, createCommentStore } from '@kerned/extension-comments';
import { parseAnchor } from '@kerned/model';
import {
  type FindState,
  createAnchor,
  resolveAnchor,
  resolveRangeDecorations,
  TextSelection,
  RangeSelection,
  textSelection,
} from '@kerned/state';
import type { MountedEditor } from '@kerned/view';
import type { ViewDiagnostics } from '@kerned/view/diagnostics';
import { checkInlineResources } from '@kerned/view/diagnostics';
import { useLayoutEffect, type RefObject } from 'react';

import { demoSchema } from '../demo-schema.js';
import type { createDemoDocumentQuery } from '../document-query.js';
import { benchmarkContainerEdits, checkContainers } from '../editor-container-checks.js';
import { checkExtensions } from '../editor-extension-checks.js';
import { checkReflow } from '../editor-reflow-checks.js';
import { checkSelections } from '../editor-selection-checks.js';
import { checkTransactions } from '../editor-transaction-checks.js';
import type { EditorSession } from '../editor-types.js';
import { importHtml } from '../import-html.js';
import type { StreamState } from './use-sample-stream.js';

type DiagnosticsOptions = {
  editor: EditorSession;
  comments: ReturnType<typeof createCommentStore<{ body: string; reply: string }>>;
  findRef: RefObject<FindState>;
  projectDocument: ReturnType<typeof createDemoDocumentQuery>;
  view: MountedEditor | null;
  diagnostics: ViewDiagnostics;
  paused: StreamState['paused'];
  metrics: StreamState['metrics'];
};

/** The audit harness combines supported session/view APIs with independent reference checks. */
export function useDiagnostics({
  editor,
  comments,
  findRef,
  projectDocument,
  view,
  diagnostics,
  paused,
  metrics,
}: DiagnosticsOptions) {
  useLayoutEffect(() => {
    if (!view) return undefined;

    function snapshot() {
      const value = diagnostics.read();

      if (!value) throw new Error('Editor diagnostics are not ready');

      return value;
    }

    function selection() {
      const value = projectDocument(editor.state).selection;

      return value instanceof TextSelection
        ? {
            id: value.head.id,
            anchorId: value.anchor.id,
            anchor: value.anchor.offset,
            focus: value.head.offset,
            upstream: value.upstream,
          }
        : value instanceof RangeSelection
          ? {
              type: 'range',
              anchor: value.anchor,
              head: value.head,
            }
          : { type: value.type };
    }

    function viewport() {
      const geometry = view?.getSnapshot();
      const zoom = geometry?.zoom ?? 1;

      return { zoom, scroll: (geometry?.viewport.top ?? 0) * zoom };
    }

    function placements(ids?: number[]) {
      return diagnostics
        .placements(ids)
        .map(({ id, y, height, layoutWidth, boxes }) => ({ id, y, height, layoutWidth, boxes }));
    }

    const api = {
      anchor: (id: number, offset: number, bias: -1 | 1) =>
        createAnchor(demoSchema, editor.state, 'editor-demo', id, offset, bias),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Parse serialized anchors at the audit boundary.
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
          projectDocument(editor.state).nodes,
          diagnostics,
          location.pathname === '/editor.html' ? 18 : 20,
        ),
      pause: () => {
        paused.current = true;
      },
      resume: () => {
        paused.current = false;
      },
      metrics: () => {
        const data = snapshot();

        return {
          ...metrics.current,
          cachedParagraphs: data.cachedParagraphs,
          residentParagraphs: data.residentParagraphs,
          retention: data.retention,
          memory: data.memory,
        };
      },
      probe: (ids: number[]) => {
        const data = snapshot();
        const nodes = projectDocument(editor.state).nodes;

        return {
          reflowPending: data.pending,
          generation: data.generation,
          stalePaints: metrics.current.stalePaints,
          count: nodes.length,
          selection: selection(),
          stats: data.stats,
          paused: paused.current,
          complete: !!metrics.current.completedAt,
          ...viewport(),
          width: data.width,
          mounted: data.mounted,
          nodes: nodes.filter((node) => ids.includes(node.id)),
          scene: placements(ids),
          layoutCalls: metrics.current.layoutCalls,
          lastLayoutIds: metrics.current.lastLayoutIds,
        };
      },
      scrollTo: (id: number, offset = 0) => {
        const bounds = view.blockBounds(id);

        if (bounds) view.scrollTo(bounds.top + offset);
      },
      checkInline: checkInlineResources,
      read: () => {
        const data = snapshot();

        return {
          nodes: projectDocument(editor.state).nodes,
          selection: selection(),
          scene: placements(),
          stats: data.stats,
          mounted: data.mounted.map(String),
          ...viewport(),
          width: data.width,
          paintCount: data.painterCount,
        };
      },
      select: (id: number, index: number) => {
        editor.select(textSelection(id, index));
        view.focus();
      },
    };

    const host: Window & { editorDiagnostics?: typeof api } = window;
    host.editorDiagnostics = api;

    return () => {
      if (host.editorDiagnostics === api) delete host.editorDiagnostics;
    };
  }, [editor, comments, findRef, projectDocument, view, diagnostics, paused, metrics]);
}
