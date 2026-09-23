import { captureComment, createCommentStore } from '@kerned/extension-comments';
import { onCommentActivate } from '@kerned/extension-comments/browser';
import { onMentionActivate } from '@kerned/extension-document/browser';
import { EditorContent, useEditorState, useViewState } from '@kerned/react';
import { textSelection } from '@kerned/state';
import type { MountedEditor } from '@kerned/view';
import { createViewDiagnostics } from '@kerned/view/diagnostics';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createDemoDocumentQuery } from '../document-query.js';
import type { EditorSample } from '../editor-samples.js';
import type { EditorSession } from '../editor-types.js';
import { FindBar } from '../find-bar.js';
import { OutlineMenu } from '../outline-menu.js';
import { AnnotationPanel, type ActivePanel } from './annotation-panel.js';
import { createEditorControls } from './editor-controls.js';
import { Toolbar } from './toolbar.js';
import { useComments } from './use-comments.js';
import { useDiagnostics } from './use-diagnostics.js';
import { useFind, useFindReveal } from './use-find.js';
import { useOutline } from './use-outline.js';
import { useSampleStream } from './use-sample-stream.js';

const readingAccessibility = { readingView: true };

const defaultAccessibility = { readingView: false };

export function EditorWorkspaceView({
  editor,
  comments,
  minimal,
  sample,
  onSampleChange,
  loading,
}: {
  editor: EditorSession;
  comments: ReturnType<typeof createCommentStore<{ body: string; reply: string }>>;
  minimal: boolean;
  sample: EditorSample;
  onSampleChange: (id: string) => void;
  loading: boolean;
}) {
  // oxlint-disable-next-line react/purity -- Render timing is telemetry only.
  const renderStarted = performance.now();
  const projectDocument = useMemo(() => createDemoDocumentQuery(editor.schema), [editor]);
  const doc = useEditorState(editor, projectDocument);
  const { editorState, nodes } = doc;

  const { commentState, decorations, seedComments } = useComments(
    editor,
    editorState,
    sample,
    comments,
  );

  const [panel, setPanel] = useState<ActivePanel | null>(null);
  const [inputNotice, setInputNotice] = useState('');
  const [view, setView] = useState<MountedEditor | null>(null);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const geometry = useViewState(view);

  const toolbarHeight =
    minimal && geometry ? window.innerHeight - geometry.viewport.height * geometry.zoom : 50;

  const [diagnostics] = useState(() => {
    const params = new URLSearchParams(location.search);

    return createViewDiagnostics({
      composition: params.get('reflow') === 'eager' ? 'eager' : 'viewport',
      retention: params.get('retention') === 'all' ? 'all' : 'viewport',
    });
  });

  const editStarted = useRef<number | null>(null);
  const stream = useSampleStream(editor, sample, seedComments, diagnostics, !!view, editStarted);
  const { loadedCount, metrics, paused, recordRender } = stream;
  useLayoutEffect(() => {
    recordRender(performance.now() - renderStarted);
  });

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
  } = useFind({ editor, scroller, view, onOpen: () => setPanel(null) });

  useFindReveal({ view, findOpen, findState, findRequest });

  const { outline, outlineAvailable, outlineActive, navigateOutline } = useOutline({
    sample,
    loadedCount,
    editorState,
    view,
    geometry,
  });

  const closePanel = useCallback(() => {
    setPanel(null);
    editor.commands.focus();
  }, [editor]);

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
        if (
          event.target instanceof Element &&
          event.target.closest('input,textarea,[contenteditable]:not([contenteditable="false"])')
        )
          return;
        event.preventDefault();
        editor.commands.selectAll();
        editor.commands.focus();
        setPanel(null);

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
  }, [editor, findOpen, closeFind, openFind]);

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

  function recordEdit() {
    // oxlint-disable-next-line react/purity -- Called by input/toolbar events; the controls factory only stores this callback.
    editStarted.current = performance.now();
  }

  // The factory captures event callbacks without invoking them during render.
  // oxlint-disable-next-line react/refs
  const actions = createEditorControls({
    editor,
    onEdit: recordEdit,
    notice: setInputNotice,
    closePanel: () => setPanel(null),
  });

  const openAnnotation = useCallback(
    (kind: 'mention' | 'comment', nodeId: number, atomId: string, index: number) => {
      if (doc.context.text(nodeId) !== null) editor.select(textSelection(nodeId, index));
      setPanel({ kind, nodeId, atomId, focus: 'panel' });
    },
    [editor, doc.context],
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
    projectDocument,
    view,
    diagnostics,
    paused,
    metrics,
  });

  return (
    <main className="editor-shell">
      <Toolbar
        {...{
          minimal,
          toolbar,
          setToolbar,
          doc,
          actions,
          addComment,
          findOpen,
          openFind,
          sample,
          loading: loading || !view,
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
      <div
        className="editor-surface"
        ref={scroller}
        onPointerDownCapture={() => setPanel(null)}
        onInputCapture={recordEdit}
        onPasteCapture={recordEdit}
        onCutCapture={recordEdit}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && panel) {
            event.preventDefault();
            closePanel();
          }
        }}
      >
        <div className="editor-frame">
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
          <EditorContent
            className="document-scroll"
            editor={editor}
            fonts={sample.fonts}
            accessibility={sample.total === 0 ? readingAccessibility : defaultAccessibility}
            diagnostics={diagnostics}
            scroll={minimal ? 'page' : 'container'}
            toolbar={minimal ? (toolbar ?? undefined) : undefined}
            maxWidth={minimal ? 696 : null}
            background={minimal ? '#ffffff' : '#fffef9'}
            zoom={zoom}
            paddingTop={findOpen ? 56 / zoom : 0}
            onReady={setView}
            onNotice={setInputNotice}
          />
          <AnnotationPanel
            {...{ panel, view, geometry, doc, comments, commentState, decorations, minimal }}
            onClose={closePanel}
          />
        </div>
      </div>
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
          </span>
        </footer>
      )}
    </main>
  );
}
