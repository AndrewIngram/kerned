import { type CanvasKit } from 'canvaskit-wasm';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FindBar } from '../../demo/find-bar';
import { createEditor, textSelection, type Selection } from '../../editor';
import { CanvasLayerProvider, Editor, useCanvasInput, useEditorViewport } from '../../editor-react';
import type { Rect } from '../../engines';
import { captureComment } from '../../extensions/comment';
import { demoSchema } from '../../extensions/demo-schema';
import { OutlineMenu } from '../../extensions/outline-view';
import { BlockLayer } from '../../extensions/starter-kit/block-layer';
import { createStarterKitInput, focusStarterKitInput } from '../../extensions/starter-kit/input';
import { useDocumentLayout } from '../../extensions/starter-kit/use-document-layout';
import { tableCells } from '../../extensions/table';
import { bookSamples, type HybridSample } from '../../hybrid-samples';
import { createOwnedEngine } from '../../owned-layout';
import { AnnotationPanel, type ActivePanel } from './annotation-panel';
import { useComments } from './use-comments';

import { useCanvasRenderer } from '../../editor-canvas/use-canvas-renderer';
import { createStarterKitActions } from '../../extensions/starter-kit/actions';
import { useEditorDocument } from '../../extensions/starter-kit/use-editor-document';
import { Toolbar } from './toolbar';
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
  sample: HybridSample;
  onSampleChange: (id: string) => void;
  loading: boolean;
}) {
  const minimal = location.pathname === '/editor.html';
  const renderStarted = performance.now();

  const [editor] = useState(() =>
    createEditor(demoSchema, sample.initial, textSelection(1, 0), [tableCells.extension]),
  );

  const doc = useEditorDocument(editor);
  const { editorState, nodes, tree, nodeIndexes, selection, selectedRange } = doc;

  function setSelection(next: Selection) {
    editor.select(next);
  }

  const { comments, commentState, decorations, commentsByNode, nodeComments, seedComments } =
    useComments(editor, editorState, sample, doc.context);

  const [panel, setPanel] = useState<ActivePanel | null>(null);
  const [focusedWidget, setFocusedWidget] = useState<number | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const [inputNotice, setInputNotice] = useState('');

  const scroller = useRef<HTMLDivElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null),
    inputRef = useRef<HTMLTextAreaElement>(null);

  const viewport = useEditorViewport(scroller, minimal);

  const {
    toolbarRef,
    viewportHeight,
    toolbarHeight,
    zoom,
    setZoom,
    width,
    scroll,
    setScroll,
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
    revealFind,
    requestFind,
    openFind,
    closeFind,
    moveFind,
  } = useFind({ editor, editorState, scroller, inputRef, onOpen: () => setPanel(null) });

  const stream = useSampleStream(editor, sample, seedComments);
  const { sourceLoaded, metrics, paused, pending, renderWork } = stream;
  const editStarted = useRef<number | null>(null);
  let findEntry = findOpen && findState.active ? tree.byId.get(findState.active.id) : undefined;

  while (findEntry && !nodeIndexes.has(findEntry.node.id))
    findEntry = findEntry.parent === null ? undefined : tree.byId.get(findEntry.parent);
  const findBlockId = findEntry?.node.id;
  const current = useRef({ nodes, selection, width });
  current.current = { nodes, selection, width };

  const layout = useDocumentLayout({
    owned,
    size: minimal ? 18 : 20,
    document: doc,
    viewport,
    panelId: panel?.nodeId,
    focusedWidget,
    findBlockId,
    findOpen,
    eager: new URLSearchParams(location.search).get('reflow') === 'eager',
    retainAll: new URLSearchParams(location.search).get('retention') === 'all',
    onLayout: (result, width) => recordSampleLayout(metrics, result, width, nodes.length),
  });

  const {
    scene,
    sceneRef,
    sceneCache,
    visible,
    top,
    widthRef,
    measurementsRef,
    activePlacement,
    caret,
  } = layout;

  const { outline, outlineAvailable, outlineActive, navigateOutline } = useOutline({
    sample,
    sourceLoaded,
    editorState,
    scene,
    tree,
    zoom,
    scroll,
    toolbarHeight,
    scrollDocumentTo,
    readScroll,
    setScroll,
  });

  const findGeometry = useMemo(
    () =>
      visible.flatMap((p) => {
        const layout = p.layout;

        if (!layout) return [];

        return (findMatches.get(p.node.id) ?? []).map((match) => ({
          match,
          rects: layout
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
    revealFind,
    scroller,
    canvasRef,
    viewport,
  });

  const { register, painters } = useCanvasRenderer({
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
    renderWork.current = performance.now() - renderStarted;

    if (pending.current) pending.current.renderMs += renderWork.current;
  });

  const { textInput, selectAll, pointerSelection, navigate } = useCanvasInput({
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
    layout: (id) => sceneCache.layoutFor(id),
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
        !event.target.closest('.hybrid-shell')
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
  }, [findOpen, selectAll]);

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

  const actions = createStarterKitActions({
    editor,
    document: doc,
    focus: (id) => focusStarterKitInput(scroller.current, inputRef.current, id),
    syncInput: () => {
      if (inputRef.current) textInput.sync(inputRef.current);
    },
    onEdit: () => {
      editStarted.current = performance.now();
    },
    notice: setInputNotice,
    closePanel: () => setPanel(null),
  });

  const inputEvents = createStarterKitInput({
    editor,
    document: doc,
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

  function closePanel() {
    setPanel(null);
    inputRef.current?.focus({ preventScroll: true });
  }

  useDiagnostics({
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
  });

  return (
    <CanvasLayerProvider value={register}>
      <main className="hybrid-shell">
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
        <Editor
          className="editor-surface"
          view={{ pointer: pointerSelection, input: { ...inputEvents, focus: setHasFocus } }}
        >
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
                  onOpen={(kind, nodeId, atomId, index) => {
                    if (doc.context.text(nodeId) !== null)
                      setSelection(textSelection(nodeId, index));
                    setPanel({ kind, nodeId, atomId, focus: 'panel' });
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
