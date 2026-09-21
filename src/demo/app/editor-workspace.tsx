import { type CanvasKit } from 'canvaskit-wasm';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createEditor } from '../../core';
import { FindBar } from '../../demo/find-bar';
import {
  CanvasLayerProvider,
  Editor,
  useCanvasInput,
  useEditorViewport,
  useEditorState,
} from '../../editor-react';
import { useCanvasRenderer } from '../../editor-react/use-canvas-renderer';
import { bookSamples, type EditorSample } from '../../editor-samples';
import type { Rect } from '../../engines';
import { captureComment } from '../../extensions/comment';
import { demoSchema } from '../../extensions/demo-schema';
import { OutlineMenu } from '../../extensions/outline-view';
import { starterExtensions } from '../../extensions/starter-kit';
import { BlockLayer } from '../../extensions/starter-kit/block-layer';
import { createStarterDocumentQuery } from '../../extensions/starter-kit/document';
import { createStarterKitInput, focusStarterKitInput } from '../../extensions/starter-kit/input';
import { useDocumentLayout } from '../../extensions/starter-kit/use-document-layout';
import { createSchema } from '../../model';
import { createOwnedEngine } from '../../owned-layout';
import { textSelection, type Selection } from '../../state';
import { AnnotationPanel, type ActivePanel } from './annotation-panel';
import { createEditorControls } from './editor-controls';
import { Toolbar } from './toolbar';
import { useComments } from './use-comments';
import { useDiagnostics } from './use-diagnostics';
import { useFind, useFindReveal } from './use-find';
import { useOutline } from './use-outline';
import { recordSampleLayout, recordSamplePaint, useSampleStream } from './use-sample-stream';

const editorSchema = createSchema({ extensions: starterExtensions });

type Owned = Awaited<ReturnType<typeof createOwnedEngine>>;

export function EditorWorkspace({
  kit,
  owned,
  sample,
  onSampleChange,
  loading,
}: {
  kit: CanvasKit;
  owned: Owned;
  sample: EditorSample;
  onSampleChange: (id: string) => void;
  loading: boolean;
}) {
  const minimal = location.pathname === '/editor.html';
  // oxlint-disable-next-line react/purity -- Render timing is telemetry only and never influences the rendered output.
  const renderStarted = performance.now();

  const [editor] = useState(() =>
    createEditor({
      schema: editorSchema,
      document: sample.initial,
      selection: textSelection(1, 0),
    }),
  );

  const projectDocument = useMemo(() => createStarterDocumentQuery(editor.schema), [editor]);
  const doc = useEditorState(editor, projectDocument);

  const layoutSource = useMemo(
    () => ({
      getSnapshot: () => projectDocument(editor.state),
      subscribe: editor.subscribe,
    }),
    [editor, projectDocument],
  );

  const { editorState, nodes, tree, nodeIndexes, selection, selectedRange } = doc;

  const setSelection = useCallback(
    (next: Selection) => {
      editor.select(next);
    },
    [editor],
  );

  const { comments, commentState, decorations, commentsByNode, nodeComments, seedComments } =
    useComments(editor, editorState, sample, doc.context);

  const [panel, setPanel] = useState<ActivePanel | null>(null);
  const [focusedWidget, setFocusedWidget] = useState<number | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const [inputNotice, setInputNotice] = useState('');

  const scroller = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const viewport = useEditorViewport(scroller, minimal);

  const {
    toolbarRef,
    viewportHeight,
    toolbarHeight,
    zoom,
    setZoom,
    width,
    scroll,
    readScroll,
    scrollDocumentTo,
  } = viewport;

  const {
    findOpen,
    findState,
    findMatches,
    findStale,
    findRef,
    findRequest,
    findFocus,
    lastQuery,
    lastFindOptions,
    requestFind,
    openFind,
    closeFind,
    moveFind,
  } = useFind({ editor, editorState, scroller, inputRef, onOpen: () => setPanel(null) });

  const stream = useSampleStream(editor, sample, seedComments);
  const { loadedCount, metrics, paused, recordRender } = stream;
  const editStarted = useRef<number | null>(null);
  let findEntry = findOpen && findState.active ? tree.byId.get(findState.active.id) : undefined;

  while (findEntry && !nodeIndexes.has(findEntry.node.id))
    findEntry = findEntry.parent === null ? undefined : tree.byId.get(findEntry.parent);
  const findBlockId = findEntry?.node.id;
  const current = useRef({ nodes, selection, width });
  useLayoutEffect(() => {
    current.current = { nodes, selection, width };
  }, [nodes, selection, width]);

  const layout = useDocumentLayout({
    owned,
    size: minimal ? 18 : 20,
    source: layoutSource,
    viewport,
    panelId: panel?.nodeId,
    focusedWidget,
    findBlockId,
    findOpen,
    eager: new URLSearchParams(location.search).get('reflow') === 'eager',
    retainAll: new URLSearchParams(location.search).get('retention') === 'all',
    onLayout: (result, widthValue) =>
      recordSampleLayout(metrics, result, widthValue, result.scene.placements.length),
  });

  const { scene, visible, top, activePlacement, caret, diagnostics: layoutDiagnostics } = layout;

  const { outline, outlineAvailable, outlineActive, navigateOutline } = useOutline({
    sample,
    loadedCount,
    editorState,
    scene,
    tree,
    zoom,
    scroll,
    toolbarHeight,
    scrollDocumentTo,
    readScroll,
  });

  const findGeometry = useMemo(
    () =>
      visible.flatMap((p) => {
        const layoutValue = p.layout;

        if (!layoutValue) return [];

        return (findMatches.get(p.node.id) ?? []).map((match) => ({
          match,
          rects: layoutValue
            .geometry(match.from, match.to, false)
            .rects.map((r): Rect => [r[0], r[1] + p.y, r[2], r[3] + p.y]),
        }));
      }),
    [visible, findMatches],
  );

  useFindReveal({
    scene,
    findOpen,
    findState,
    findRequest,
    findBlockId,
    scroller,
    canvasRef,
    viewport,
  });

  const { register, diagnostics: canvasDiagnostics } = useCanvasRenderer({
    inset: layout.inset,
    kit,
    canvasRef,
    width,
    height: viewportHeight,
    zoom,
    top,
    background: minimal ? [255, 255, 255] : [255, 254, 249],
    blocks: visible,
    selectedRange,
    highlights: findGeometry.map(({ match, rects }) => ({
      rects,
      active: match === findState.active,
    })),
    caret,
    caretTop: activePlacement?.y ?? 0,
    focused: hasFocus,
    onPaint: (report) =>
      recordSamplePaint({
        stream,
        report,
        scene,
        visible,
        editStarted,
        loaded: nodes.length,
        revision: editorState.revision,
        total: sample.total,
      }),
  });

  useLayoutEffect(() => {
    recordRender(performance.now() - renderStarted);
  });

  const { textInput, selectAll, pointerSelection, navigate, revealSelection } = useCanvasInput({
    context: doc.context,
    inset: layout.inset,
    schema: demoSchema,
    editor,
    selection,
    nodes,
    canvasRef,
    inputRef,
    node: (id) => tree.byId.get(id)?.node,
    placements: scene.placements,
    layout: layout.layoutFor,
    caret,
    activeTop: activePlacement?.y,
    viewport,
    afterSelectAll: () => setPanel(null),
    onStart(hit, clicks) {
      const node = tree.byId.get(hit.point.id)?.node;

      const comment =
        clicks === 1 && (node?.kind === 'paragraph' || node?.kind === 'heading')
          ? commentsByNode
              .get(node.id)
              ?.find((c) => hit.point.offset >= c.from && hit.point.offset <= c.to)
          : undefined;

      setPanel(
        comment
          ? { kind: 'comment', nodeId: hit.point.id, atomId: comment.id, focus: 'text' }
          : null,
      );
    },
    onDrag: () => setPanel(null),
  });

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;

      if (
        event.target instanceof Element &&
        event.target !== document.body &&
        !event.target.closest('.editor-shell')
      )
        return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        // The page and toolbar can own focus after loading or switching samples.
        // Editable controls retain their native selection and clipboard behavior.
        if (
          event.target instanceof Element &&
          event.target.closest('input,textarea,[contenteditable]:not([contenteditable="false"])')
        )
          return;
        event.preventDefault();
        selectAll();

        return;
      }

      if (findOpen && event.key === 'Escape') {
        event.preventDefault();
        closeFind();

        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      openFind();
    };

    window.addEventListener('keydown', key);

    return () => window.removeEventListener('keydown', key);
  }, [findOpen, selectAll, closeFind, openFind]);

  function addComment() {
    const thread = captureComment(editor, crypto.randomUUID(), [{ body: '', reply: '' }]);

    if (!thread) return;
    comments.put(thread);
    setPanel({
      kind: 'comment',
      nodeId: doc.focusId ?? editorState.nodes[0].id,
      atomId: thread.id,
      focus: 'panel',
    });
  }

  // The factory stores callbacks for later events; it does not invoke them during render.
  // oxlint-disable-next-line react/refs
  const actions = createEditorControls({
    editor,
    syncInput: () => {
      if (inputRef.current) textInput.sync(inputRef.current);
    },
    onEdit: () => {
      // oxlint-disable-next-line react/purity -- This timestamp is captured by an edit event, not during render.
      editStarted.current = performance.now();
    },
    notice: setInputNotice,
    closePanel: () => setPanel(null),
  });

  // oxlint-disable-next-line react/refs -- Input bindings capture DOM getters without invoking them.
  const inputEvents = createStarterKitInput({
    editor,
    actions,
    textInput,
    input: () => inputRef.current,
    notice: setInputNotice,
    closePanel: () => setPanel(null),
    escape: () => {
      if (findOpen) closeFind();
      else closePanel();
    },
    selectAll,
    navigate,
  });

  // oxlint-disable-next-line react/preserve-manual-memoization -- The DOM ref object stays stable; callbacks only mutate its current element.
  const closePanel = useCallback(() => {
    setPanel(null);
    inputRef.current?.focus({ preventScroll: true });
    // oxlint-disable-next-line react/preserve-manual-memoization -- useRef preserves this object identity across renders.
  }, [inputRef]);

  const editorView = useMemo(
    () => ({
      session: editor,
      pointer: pointerSelection,
      input: { ...inputEvents, focus: setHasFocus },
      focusSelection: () =>
        focusStarterKitInput(
          scroller.current,
          inputRef.current,
          projectDocument(editor.state).focusId ?? undefined,
        ),
      revealSelection,
    }),
    [editor, pointerSelection, inputEvents, revealSelection, projectDocument, scroller, inputRef],
  );

  const openAnnotation = useCallback(
    (kind: 'mention' | 'comment', nodeId: number, atomId: string, index: number) => {
      if (doc.context.text(nodeId) !== null) setSelection(textSelection(nodeId, index));
      setPanel({ kind, nodeId, atomId, focus: 'panel' });
    },
    [doc.context, setSelection],
  );

  useDiagnostics({
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
  });

  return (
    <CanvasLayerProvider value={register}>
      <main className="editor-shell">
        <Toolbar
          {...{
            minimal,
            toolbarRef,
            doc,
            actions,
            addComment,
            findOpen,
            openFind,
            sample,
            loading,
            onSampleChange,
            editor,
            zoom,
            setZoom,
          }}
        />
        {!minimal && (
          <div className="document-heading">
            <h1>{sample.title}</h1>
            {sample.description && <p>{sample.description}</p>}
          </div>
        )}
        {minimal && (
          <OutlineMenu
            availableKeys={outlineAvailable}
            entries={outline}
            activeKey={outlineActive}
            onNavigate={navigateOutline}
            toolbarHeight={toolbarHeight}
          />
        )}
        <Editor className="editor-surface" view={editorView}>
          <div
            className="editor-frame"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && panel) {
                e.preventDefault();
                closePanel();
              }
            }}
          >
            {findOpen && (
              <div className="find-anchor" style={{ top: minimal ? toolbarHeight : 0 }}>
                <FindBar
                  state={findState}
                  initialQuery={lastQuery.current}
                  initialOptions={lastFindOptions.current}
                  stale={findStale}
                  focusRequest={findFocus}
                  onQuery={requestFind}
                  onMove={moveFind}
                  onClose={closeFind}
                />
              </div>
            )}
            <div className="document-scroll" ref={scroller}>
              <div
                className="document-space"
                style={{ height: Math.max(scene.height * zoom, viewportHeight) }}
              >
                <canvas
                  ref={canvasRef}
                  style={{
                    width,
                    height: viewportHeight,
                    top: minimal ? toolbarHeight : undefined,
                  }}
                  aria-label="Canvas document"
                />
                <BlockLayer
                  {...{
                    doc,
                    actions,
                    layout,
                    viewport,
                    kit,
                    owned,
                    commentsByNode,
                    nodeComments,
                    clipboard: inputEvents,
                    findMatches,
                    findOpen,
                    findState,
                    setSelection,
                    setFocusedWidget,
                  }}
                  onOpen={openAnnotation}
                />
              </div>
            </div>
            <textarea
              ref={inputRef}
              className="text-capture"
              tabIndex={-1}
              aria-label="Canvas text input"
              autoComplete="off"
              spellCheck={false}
            />
            <AnnotationPanel
              {...{ panel, scene, comments, commentState, decorations, viewport, minimal }}
              onClose={closePanel}
            />
          </div>
        </Editor>
        <p className="input-notice" role="status">
          {inputNotice}
        </p>
        {!minimal && (
          <footer>
            Canvas text · React controls · Paragraph-local layout{' '}
            <span>
              {sample.total
                ? `${nodes.length.toLocaleString()} / ${sample.total.toLocaleString()} blocks`
                : ''}
              {!bookSamples.some((book) => book.id === sample.id)
                ? ` · ${visible.filter((p) => p.node.kind === 'checklist').length} mounted checklists`
                : ''}
            </span>
          </footer>
        )}
      </main>
    </CanvasLayerProvider>
  );
}
