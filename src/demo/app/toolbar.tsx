import { useEffect, type RefCallback } from 'react';

import { FindIcon } from '../../demo/find-bar';
import { bookSamples, type EditorSample } from '../../editor-samples';
import type { EditorDocument } from '../document-query.js';
import type { EditorSession } from '../editor-types.js';
import type { EditorControls } from './editor-controls';

type ToolbarProps = { doc: EditorDocument; actions: EditorControls } & {
  minimal: boolean;
  toolbar: HTMLElement | null;
  setToolbar: RefCallback<HTMLElement>;
  addComment: () => void;
  findOpen: boolean;
  openFind: () => void;
  sample: EditorSample;
  loading: boolean;
  onSampleChange: (id: string) => void;
  editor: EditorSession;
  zoom: number;
  setZoom: (zoom: number) => void;
};

export function Toolbar({
  minimal,
  toolbar,
  setToolbar,
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
}: ToolbarProps) {
  const { blockLabel, selectedBlocks, active } = doc;

  const {
    setHeading,
    indentList,
    toggleList,
    toggleQuote,
    blocks,
    formatPressed,
    formatting,
    toggleFormat,
    clearMarks,
    insertTable,
    selectedTable,
    changeTable,
    restore,
  } = actions;

  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      for (const menu of toolbar?.querySelectorAll('details[open]') ?? []) {
        if (event instanceof KeyboardEvent) {
          if (event.key !== 'Escape') continue;
          menu.removeAttribute('open');
          menu.querySelector('summary')?.focus();
        } else if (event.target instanceof Node && !menu.contains(event.target))
          menu.removeAttribute('open');
      }
    };

    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);

    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [toolbar]);

  return minimal ? (
    <header ref={setToolbar} className="minimal-toolbar" aria-label="Formatting" role="toolbar">
      <div className="toolbar-inner">
        <details
          className="blocks-menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.currentTarget.open = false;
              e.currentTarget.querySelector('summary')?.focus();
            }
          }}
        >
          <summary aria-label={`Block type: ${blockLabel}`}>
            <span>{blockLabel}</span>
          </summary>
          <div
            role="group"
            aria-label="Block commands"
            onClick={(e) => e.currentTarget.parentElement?.removeAttribute('open')}
          >
            <button
              disabled={!selectedBlocks.some((n) => n.kind === 'paragraph' || n.kind === 'heading')}
              onClick={() => setHeading(null)}
            >
              Paragraph
            </button>
            {([1, 2, 3, 4] as const).map((level) => (
              <button
                key={level}
                disabled={
                  !selectedBlocks.some((n) => n.kind === 'paragraph' || n.kind === 'heading')
                }
                aria-pressed={active?.kind === 'heading' && active.level === level}
                onClick={() => setHeading(level)}
              >
                Heading {level}
              </button>
            ))}

            <button disabled={!selectedBlocks.length} onClick={() => toggleList(false)}>
              Bullet list
            </button>
            <button disabled={!selectedBlocks.length} onClick={() => toggleList(true)}>
              Numbered list
            </button>
          </div>
        </details>
        <span className="toolbar-divider" />
        <button
          aria-label="Bold"
          title="Bold selected text (⌘B)"
          aria-pressed={formatPressed('bold')}
          disabled={!formatting.available}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleFormat('bold')}
        >
          <b>B</b>
        </button>
        <button
          aria-label="Italic"
          title="Italic selected text (⌘I)"
          aria-pressed={formatPressed('italic')}
          disabled={!formatting.available}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleFormat('italic')}
        >
          <i>I</i>
        </button>
        <button
          aria-label="Underline"
          title="Underline selected text"
          aria-pressed={formatPressed('underline')}
          disabled={!formatting.available}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleFormat('underline')}
        >
          <u>U</u>
        </button>
        <button
          aria-label="Clear formatting"
          title="Clear formatting"
          disabled={!formatting.available}
          onMouseDown={(e) => e.preventDefault()}
          onClick={clearMarks}
        >
          Tx
        </button>
        <button
          aria-label="Add comment"
          title="Comment on selection"
          disabled={
            doc.editorState.selection.isEmpty(doc.context) ||
            !['text', 'node', 'range', 'all'].includes(doc.editorState.selection.type)
          }
          onMouseDown={(e) => e.preventDefault()}
          onClick={addComment}
        >
          <svg
            aria-hidden="true"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 11v6a2 2 0 0 1-2 2H7l-4 3V5a2 2 0 0 1 2-2h8M19 2v6M16 5h6" />
          </svg>
        </button>

        <button
          aria-label="Block quote"
          title="Block quote"
          aria-pressed={blocks.quoted}
          disabled={!selectedBlocks.length}
          onClick={toggleQuote}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 6H4v7h6V6Zm10 0h-6v7h6V6ZM10 13c0 4-2 5-5 5m15-5c0 4-2 5-5 5" />
          </svg>
        </button>
        <button
          aria-label="Indent list item"
          title="Indent list item"
          disabled={blocks.item === undefined}
          onClick={() => indentList()}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5h9M12 12h9M12 19h9M3 8l4 4-4 4" />
          </svg>
        </button>
        <button
          aria-label="Outdent list item"
          title="Outdent list item"
          disabled={blocks.item === undefined}
          onClick={() => indentList(true)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5h9M12 12h9M12 19h9M7 8l-4 4 4 4" />
          </svg>
        </button>
        <details className="table-menu">
          <summary aria-label="Table" title="Table">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 3h18v18H3zM3 9h18M9 3v18" />
            </svg>
          </summary>
          <div
            role="group"
            aria-label="Table commands"
            onClick={(e) => e.currentTarget.parentElement?.removeAttribute('open')}
          >
            <button onClick={insertTable}>Table (3 × 3)</button>
            {selectedTable() && <button onClick={() => changeTable(false)}>Add table row</button>}
            {selectedTable() && <button onClick={() => changeTable(true)}>Add table column</button>}
          </div>
        </details>
        <div className="toolbar-trailing">
          <button
            aria-label="Find"
            title="Find in document (⌘F / Ctrl+F)"
            aria-expanded={findOpen}
            onClick={openFind}
          >
            <FindIcon />
          </button>
          <select
            className="sample-picker"
            aria-label="Sample"
            value={bookSamples.some((book) => book.id === sample.id) ? sample.id : 'minimal'}
            disabled={loading}
            onChange={(e) => onSampleChange(e.target.value)}
          >
            <option value="minimal">Draft</option>
            {bookSamples.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>
          <button
            aria-label="Undo"
            title="Undo (⌘Z)"
            disabled={!editor.can().undo()}
            onClick={() => restore()}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 4-5 5 5 5M4 9h9a7 7 0 0 1 0 14" />
            </svg>
          </button>
          <button
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
            disabled={!editor.can().redo()}
            onClick={() => restore(true)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 4 5 5-5 5M20 9h-9a7 7 0 0 0 0 14" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  ) : (
    <header className="app-header">
      <strong>
        gprose <span> / Extension study</span>
      </strong>
      <div>
        <label>
          Sample{' '}
          <select
            value={sample.id}
            disabled={loading}
            onChange={(e) => onSampleChange(e.target.value)}
          >
            <option value="extensions">Launch notes</option>
            <option value="stream">10,000 mixed blocks</option>
            {bookSamples.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>
        </label>
        <button aria-label="Find" aria-expanded={findOpen} onClick={openFind}>
          <FindIcon />
        </button>
        <button onClick={() => restore()}>Undo</button>
        <button onClick={() => restore(true)}>Redo</button>
        <label>
          Zoom{' '}
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            <option value={1}>100%</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
          </select>
        </label>
      </div>
    </header>
  );
}
