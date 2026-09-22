import { formattingSpans } from '@gprose/extension-document';
import type { NodeIdentity, Schema, TextPoint } from '@gprose/model';
import {
  TextSelection,
  textSelection,
  type Selection,
  type SelectionContext,
  type NodeAccess,
} from '@gprose/state';
import type { InputHandlers } from '@gprose/view';
import { nativeTextCaret, revealNativeText } from '@gprose/view';
import type { ReadTextDecorations, TextDecoration } from '@gprose/view';
import { applyTextStyle, type ReadTextStyle, type TextStyle } from '@gprose/view';

import { createTableContent, type TableText, type TableCellContent } from './table-content.js';
import { tableCells } from './table.js';

export type TableFrame<N extends NodeIdentity = NodeIdentity> = {
  node: N;
  width: number;
  onMeasure: (id: number, width: number, height: number) => void;
  selection: Selection;
  context: SelectionContext;
  access: (id: number) => NodeAccess | undefined;
  onSelect: (selection: Selection) => void;
  onText: (
    id: number,
    from: number,
    to: number,
    text: string,
    caret: number,
    input: { composing: boolean; pasted: boolean },
  ) => boolean;
  onComposition: (composing: boolean) => void;
  afterComposition?: () => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
  onReplace: (text: string) => void;
  clipboard: Pick<InputHandlers, 'copy' | 'cut' | 'paste'>;
  textDecorations?: ReadTextDecorations;
  textStyle: ReadTextStyle;
};

const emptyMatches: readonly TextDecoration[] = [];

function paintText(
  element: HTMLElement,
  paragraph: TableText,
  matches: readonly TextDecoration[],
  readStyle: ReadTextStyle,
  header: boolean,
) {
  const document = element.ownerDocument;
  const text = document.createElement('p');
  const spans = formattingSpans(paragraph.marks);

  const cuts = [
    ...new Set([
      0,
      paragraph.text.length,
      ...spans.flatMap((span) => [span.start, span.end]),
      ...matches.flatMap((match) => [match.from, match.to]),
    ]),
  ].toSorted((a, b) => a - b);

  for (const [index, start] of cuts.slice(0, -1).entries()) {
    const span = document.createElement('span');
    const active = spans.filter((mark) => mark.start <= start && mark.end > start);
    const decorations = matches.filter((value) => value.from <= start && value.to > start);
    span.textContent = paragraph.text.slice(start, cuts[index + 1]);

    const style = readStyle(paragraph.id, {
      bold: header || active.some((mark) => mark.bold),
      italic: active.some((mark) => mark.italic),
    });

    if (style) {
      span.style.fontFamily = style.cssFamily;
      span.style.fontWeight = String(style.font.weight);
      span.style.fontStyle = style.font.style;
    }

    if (active.some((mark) => mark.underline)) span.style.textDecoration = 'underline';

    let content = span;

    for (const decoration of decorations.toReversed()) {
      const wrapper = document.createElement('span');
      wrapper.dataset.decorationKey = decoration.key;
      wrapper.style.backgroundColor = decoration.background;

      for (const [name, value] of Object.entries(decoration.attributes ?? {}))
        wrapper.setAttribute(name, value);
      wrapper.append(content);
      content = wrapper;
    }

    text.append(content);
  }

  if (paragraph.text.endsWith('\n')) text.append(document.createTextNode('\u200b'));
  element.replaceChildren(text);

  if (!paragraph.text) {
    const empty = document.createElement('span');
    empty.className = 'empty-cell';
    empty.textContent = '\u00a0';
    element.append(empty);
  }
}

type CellView = {
  element: HTMLTableCellElement;
  selector: HTMLButtonElement;
};

type ParagraphView = {
  element: HTMLButtonElement | HTMLTextAreaElement;
  paragraph?: TableText;
  matches?: readonly TextDecoration[];
  style?: TextStyle;
};

/** Owns the table's DOM, native editing, selection and measurement independently of React.
 * Updates retain keyed cells and textareas so transactions never replace an active input.
 */
export function createTableView<N extends NodeIdentity>(
  element: HTMLDivElement,
  schema: Schema<N>,
) {
  const project = createTableContent(schema);
  const document = element.ownerDocument;
  const table = document.createElement('table');
  const caption = document.createElement('caption');
  const body = document.createElement('tbody');
  table.append(body);
  element.append(table);
  element.classList.add('table-block');
  element.tabIndex = -1;
  element.dataset.editorInteractive = '';
  const rows = new Map<number, HTMLTableRowElement>();
  const cells = new Map<number, CellView>();
  const paragraphs = new Map<number, ParagraphView>();
  let frame: (Omit<TableFrame<N>, 'node'> & { node: ReturnType<typeof project> }) | undefined;
  let source: N | undefined;
  let editing: number | null = null;
  let destroyed = false;
  let composing = false;
  let compositionFrame = 0;
  const cleanup: (() => void)[] = [];

  function listen<K extends keyof HTMLElementEventMap>(
    name: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ) {
    element.addEventListener(name, handler);
    cleanup.push(() => element.removeEventListener(name, handler));
  }

  function report() {
    if (!destroyed && frame) frame.onMeasure(frame.node.id, frame.width, element.offsetHeight);
  }

  function selectedCells() {
    return frame?.selection instanceof tableCells.CellSelection &&
      frame.selection.tableId === frame.node.id
      ? new Set(frame.selection.cells(frame.context))
      : new Set<number>();
  }

  function input() {
    const current = editing === null ? undefined : paragraphs.get(editing)?.element;

    return current instanceof HTMLTextAreaElement ? current : null;
  }

  function selectNative() {
    const current = input();

    if (!frame || !current || composing || document.activeElement !== current || editing === null)
      return;

    const next =
      current.selectionDirection === 'backward'
        ? textSelection(editing, current.selectionEnd, current.selectionStart)
        : textSelection(editing, current.selectionStart, current.selectionEnd);

    if (!frame.selection.eq(next)) frame.onSelect(next);
  }

  function selectCell(cell: TableCellContent, extend: boolean) {
    if (!frame) return;
    const { selection, node } = frame;

    const anchor = extend
      ? selection instanceof tableCells.CellSelection
        ? selection.anchorCell
        : selection instanceof TextSelection
          ? node.rows
              .flat()
              .find((value) => value.paragraphs.some((p) => p.id === selection.anchor.id))?.id
          : undefined
      : undefined;

    editing = null;
    frame.onSelect(new tableCells.CellSelection(node.id, anchor ?? cell.id, cell.id));
    render(true);
  }

  function edit(id: number) {
    if (!frame) return;
    editing = id;
    frame.onSelect(textSelection(id, 0));
    render(true);
  }

  function render(syncSelection: boolean) {
    if (!frame || destroyed) return;
    const selected = selectedCells();
    let resizeInput = syncSelection;

    if (selected.size) editing = null;
    const rowIds = new Set<number>();
    const cellIds = new Set<number>();
    const paragraphIds = new Set<number>();
    element.dataset.table = String(frame.node.id);
    table.setAttribute('aria-label', frame.node.caption || 'Table');
    table.style.minWidth = `${Math.max(1, frame.node.rows[0]?.reduce((total, cell) => total + cell.colspan, 0) ?? 1) * 100}px`;
    caption.textContent = frame.node.caption;

    if (frame.node.caption && caption.parentNode !== table) table.prepend(caption);

    if (!frame.node.caption) caption.remove();

    for (const [rowIndex, row] of frame.node.rows.entries()) {
      const rowId = row[0].id;
      rowIds.add(rowId);
      const tr = rows.get(rowId) ?? document.createElement('tr');
      rows.set(rowId, tr);

      if (body.children[rowIndex] !== tr) body.insertBefore(tr, body.children[rowIndex] ?? null);

      for (const [cellIndex, cell] of row.entries()) {
        cellIds.add(cell.id);
        let view = cells.get(cell.id);
        const tag = cell.header ? 'TH' : 'TD';

        if (!view || view.element.tagName !== tag) {
          const td = document.createElement(cell.header ? 'th' : 'td');
          const selector = document.createElement('button');
          selector.type = 'button';
          selector.className = 'cell-selector';
          selector.textContent = '↖';
          td.append(selector);
          view?.element.replaceWith(td);
          view = { element: td, selector };
          cells.set(cell.id, view);
        }

        if (tr.children[cellIndex] !== view.element)
          tr.insertBefore(view.element, tr.children[cellIndex] ?? null);
        view.element.dataset.cell = String(cell.id);
        view.element.dataset.selected = String(selected.has(cell.id));
        view.element.colSpan = cell.colspan;
        view.element.rowSpan = cell.rowspan;
        view.selector.setAttribute('aria-label', `Select cell ${rowIndex + 1}, ${cellIndex + 1}`);

        let previousAfter = 0;

        for (const [paragraphIndex, paragraph] of cell.paragraphs.entries()) {
          paragraphIds.add(paragraph.id);
          let content = paragraphs.get(paragraph.id);
          const isEditing = editing === paragraph.id;

          if (!content || content.element instanceof HTMLTextAreaElement !== isEditing) {
            const child = document.createElement(isEditing ? 'textarea' : 'button');
            child.dataset.textBlock = String(paragraph.id);

            if (child instanceof HTMLButtonElement) {
              child.type = 'button';
              child.className = 'cell-content';
            }

            content?.element.replaceWith(child);
            content = { element: child };
            paragraphs.set(paragraph.id, content);
          }

          if (view.element.children[paragraphIndex + 1] !== content.element)
            view.element.insertBefore(
              content.element,
              view.element.children[paragraphIndex + 1] ?? null,
            );
          const matches = frame.textDecorations?.(paragraph.id) ?? emptyMatches;
          const style = frame.textStyle(paragraph.id, { bold: cell.header });

          if (!style) throw new Error(`Missing text style for table paragraph ${paragraph.id}`);

          const metricsChanged =
            !content.style ||
            content.style.size !== style.size ||
            content.style.lineHeight !== style.lineHeight ||
            content.style.cssFamily !== style.cssFamily ||
            content.style.baselineOffset !== style.baselineOffset;

          if (content.style !== style) applyTextStyle(content.element, style);
          content.element.style.marginTop = paragraphIndex
            ? `${Math.max(previousAfter, style.before)}px`
            : '0px';
          previousAfter = style.after;

          if (content.element instanceof HTMLTextAreaElement) {
            content.element.readOnly = frame.access(paragraph.id) !== 'editable';
            resizeInput ||= metricsChanged;
            content.element.setAttribute(
              'aria-label',
              `Cell ${rowIndex + 1}, ${cellIndex + 1} text`,
            );

            if (!composing && content.element.value !== paragraph.text)
              content.element.value = paragraph.text;
          } else {
            content.element.setAttribute(
              'aria-label',
              `Edit cell ${rowIndex + 1}, ${cellIndex + 1}${paragraphIndex ? `, paragraph ${paragraphIndex + 1}` : ''}`,
            );

            if (content.paragraph !== paragraph || content.matches !== matches || metricsChanged)
              paintText(content.element, paragraph, matches, frame.textStyle, cell.header);
          }

          content.paragraph = paragraph;
          content.matches = matches;
          content.style = style;
        }
      }
    }

    for (const [id, view] of paragraphs)
      if (!paragraphIds.has(id)) {
        view.element.remove();
        paragraphs.delete(id);
      }

    for (const [id, view] of cells)
      if (!cellIds.has(id)) {
        view.element.remove();
        cells.delete(id);
      }

    for (const [id, row] of rows)
      if (!rowIds.has(id)) {
        row.remove();
        rows.delete(id);
      }

    if (editing !== null && !paragraphIds.has(editing)) editing = null;
    const textarea = input();
    const { selection } = frame;

    if (syncSelection && !composing) {
      if (textarea && selection instanceof TextSelection && selection.head.id === editing) {
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(
          Math.min(selection.anchor.offset, selection.head.offset),
          Math.max(selection.anchor.offset, selection.head.offset),
          selection.anchor.offset > selection.head.offset ? 'backward' : 'forward',
        );
      } else if (selected.size) element.focus({ preventScroll: true });
    }

    if (textarea && resizeInput) {
      textarea.style.height = '0px';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }

    report();
  }

  listen('click', (event) => {
    if (!frame || !(event.target instanceof Element)) return;
    const target = event.target.closest('button');
    const cellId = Number(target?.closest('[data-cell]')?.getAttribute('data-cell'));
    const cell = frame.node.rows.flat().find((value) => value.id === cellId);

    if (!target || !cell) return;

    if (target.classList.contains('cell-selector') || event.shiftKey)
      selectCell(cell, event.shiftKey);
    else if (target.dataset.textBlock) edit(Number(target.dataset.textBlock));
  });
  listen('input', (event) => {
    if (
      !frame ||
      event.target !== input() ||
      !(event.target instanceof HTMLTextAreaElement) ||
      editing === null
    )
      return;
    const paragraph = paragraphs.get(editing)?.paragraph;

    if (!paragraph) return;
    const value = event.target.value;
    const old = paragraph.text;
    let from = 0;

    while (from < old.length && from < value.length && old[from] === value[from]) from++;
    let end = old.length;
    let tail = value.length;

    while (end > from && tail > from && old[end - 1] === value[tail - 1]) {
      end--;
      tail--;
    }

    if (from === end && from === tail) return;

    if (
      !frame.onText(paragraph.id, from, end, value.slice(from, tail), event.target.selectionStart, {
        composing: composing || (event instanceof InputEvent && event.isComposing),
        pasted:
          event instanceof InputEvent &&
          ['insertFromPaste', 'insertFromDrop'].includes(event.inputType),
      })
    ) {
      event.target.value = paragraph.text;
      render(true);
    }
  });
  listen('select', selectNative);
  document.addEventListener('selectionchange', selectNative);
  cleanup.push(() => document.removeEventListener('selectionchange', selectNative));
  listen('compositionstart', () => {
    cancelAnimationFrame(compositionFrame);
    composing = true;
    frame?.onComposition(true);
  });
  listen('compositionend', () => {
    composing = false;
    frame?.onComposition(false);
    compositionFrame = requestAnimationFrame(() => frame?.afterComposition?.());
  });
  listen('focusout', (event) => {
    if (
      event.target === input() &&
      event.relatedTarget instanceof HTMLElement &&
      !element.contains(event.relatedTarget)
    ) {
      editing = null;
      render(false);
    }
  });
  listen('keydown', (event) => {
    if (!frame || event.isComposing || composing) return;

    if (frame.onKeyDown(event) || event.defaultPrevented) return;

    if (selectedCells().size && (event.key === 'Backspace' || event.key === 'Delete')) {
      event.preventDefault();
      frame.onReplace('');
    }

    if (event.key === 'Escape') {
      editing = null;
      render(false);
    }

    if (event.key === 'Tab' && event.target === input()) {
      event.preventDefault();
      const content = frame.node.rows.flat().flatMap((cell) => cell.paragraphs);
      const index = content.findIndex((paragraph) => paragraph.id === editing);
      const next = content[index + (event.shiftKey ? -1 : 1)];

      if (next) edit(next.id);
    }
  });
  listen('copy', (event) => {
    if (selectedCells().size) frame?.clipboard.copy?.(event);
  });
  listen('cut', (event) => {
    if (selectedCells().size) frame?.clipboard.cut?.(event);
  });
  listen('paste', (event) => frame?.clipboard.paste?.(event));
  const observer = new ResizeObserver(report);
  observer.observe(element);

  return {
    update(next: TableFrame<N>) {
      if (destroyed) throw new Error('Table view is destroyed');

      const syncSelection =
        !frame ||
        source !== next.node ||
        frame.width !== next.width ||
        !frame.selection.eq(next.selection);

      source = next.node;
      frame = { ...next, node: project(next.node) };
      render(syncSelection);
    },
    focusSelection(selection: Selection) {
      if (!frame || destroyed) return false;

      if (
        selection instanceof TextSelection &&
        selection.anchor.id === selection.head.id &&
        paragraphs.has(selection.head.id)
      ) {
        editing = selection.head.id;
      } else if (
        selection instanceof tableCells.CellSelection &&
        selection.tableId === frame.node.id
      ) {
        editing = null;
      } else return false;
      frame = { ...frame, selection };
      render(true);

      return true;
    },
    coordsAt(point: TextPoint) {
      if (destroyed) return null;
      const paragraph = paragraphs.get(point.id);

      if (!paragraph?.paragraph || point.offset > paragraph.paragraph.text.length) return null;

      return nativeTextCaret(paragraph.element, point.offset);
    },
    reveal(point: TextPoint) {
      if (destroyed) return;
      const paragraph = paragraphs.get(point.id);

      if (!paragraph?.paragraph || point.offset > paragraph.paragraph.text.length) return;
      const target = paragraph.element;
      revealNativeText(
        target,
        point.offset,
        target instanceof HTMLTextAreaElement ? [target, element] : [element],
      );
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(compositionFrame);
      observer.disconnect();

      for (const dispose of cleanup) dispose();
      frame = undefined;
      source = undefined;
      rows.clear();
      cells.clear();
      paragraphs.clear();
      element.replaceChildren();
      element.classList.remove('table-block');
      element.removeAttribute('tabindex');
      delete element.dataset.editorInteractive;
      delete element.dataset.table;
    },
  };
}
