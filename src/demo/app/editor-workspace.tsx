import { type CanvasKit } from 'canvaskit-wasm';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createEditor } from '../../core';
import { FindBar } from '../../demo/find-bar';
import {
  CanvasLayerProvider,
  useCanvasInput,
  useEditorViewport,
  useEditorState,
} from '../../editor-react';
import { EditorEventHost } from '../../editor-react/editor-event-host';
import { useCanvasRenderer } from '../../editor-react/use-canvas-renderer';
import { useDocumentLayout } from '../../editor-react/use-document-layout';
import { type EditorSample } from '../../editor-samples';
import { streamConfig } from '../../editor-stream';
import { captureComment, createCommentStore } from '../../extensions/comment';
import { commentView, onCommentActivate } from '../../extensions/comment-view';
import { demoSchema } from '../../extensions/demo-schema';
import { OutlineMenu } from '../../extensions/outline-view';
import { searchView } from '../../extensions/search-view';
import { BlockLayer } from '../../extensions/starter-kit/block-layer';
import { starterBrowserExtensions, onMentionActivate } from '../../extensions/starter-kit/browser';
import { createStarterDocumentQuery } from '../../extensions/starter-kit/browser-document';
import { createStarterKitInput, focusStarterKitInput } from '../../extensions/starter-kit/input';
import { createStarterPresentation } from '../../extensions/starter-kit/presentation';
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

  const [comments] = useState(() => createCommentStore<{ body: string; reply: string }>());

  const [editor] = useState(() =>
    createEditor({
      schema: createSchema({
        extensions: [
          commentView(comments),
          searchView,
          ...starterBrowserExtensions({ imageDelay: streamConfig.imageDelay }),
        ],
      }),
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

  const { editorState, nodes, tree, selection, selectedRange } = doc;

  const setSelection = useCallback(
    (next: Selection) => {
      editor.select(next);
    },
    [editor],
  );

  const { commentState, decorations, seedComments } = useComments(
    editor,
    editorState,
    sample,
    comments,
  );

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
  } = useFind({ editor, scroller, inputRef, onOpen: () => setPanel(null) });

  const stream = useSampleStream(editor, sample, seedComments);
  const { loadedCount, metrics, paused, recordRender } = stream;
  const editStarted = useRef<number | null>(null);

  const findBlockId =
    findOpen && findState.active ? doc.blockFor(findState.active.id)?.id : undefined;

  const current = useRef({ nodes, selection, width });
  useLayoutEffect(() => {
    current.current = { nodes, selection, width };
  }, [nodes, selection, width]);

  const presentation = useMemo(() => createStarterPresentation(minimal ? 18 : 20), [minimal]);

  const layout = useDocumentLayout({
    owned,
    present: presentation,
    source: layoutSource,
    viewport,
    pinned: [panel?.nodeId, focusedWidget, findBlockId].filter((id) => id != null),
    paddingTop: findOpen ? 56 / zoom : 0,
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

  const { textInput, selectAll, pointerSelection, navigate, revealSelection, onTextPointer } =
    useCanvasInput({
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
      onStart() {
        setPanel(null);
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
  const { events: inputEvents } = createStarterKitInput({
    editor,
    onEdit: () => {
      // oxlint-disable-next-line react/purity -- The native adapter captures this edit-event callback.
      editStarted.current = performance.now();
    },
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

  useLayoutEffect(
    () =>
      onMentionActivate(editor, ({ nodeId, id, index }) => {
        openAnnotation('mention', nodeId, id, index);
      }),
    [editor, openAnnotation],
  );
  useLayoutEffect(
    () =>
      onCommentActivate(editor, ({ nodeId, id, index, focus }) => {
        if (focus === 'panel') openAnnotation('comment', nodeId, id, index);
        else setPanel({ kind: 'comment', nodeId, atomId: id, focus: 'text' });
      }),
    [editor, openAnnotation],
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
        <EditorEventHost className="editor-surface" view={editorView}>
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
                  editor={editor}
                  onTextPointer={onTextPointer}
                  {...{
                    doc,
                    layout,
                    viewport,
                    owned,
                    clipboard: inputEvents,
                    notice: setInputNotice,
                    setFocusedWidget,
                  }}
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
        </EditorEventHost>
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
              {` · ${visible.filter((p) => p.node.kind === 'table' || p.node.kind === 'image').length} mounted blocks`}
            </span>
          </footer>
        )}
      </main>
    </CanvasLayerProvider>
  );
}
