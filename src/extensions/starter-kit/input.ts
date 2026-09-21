import { createTextInput, type BrowserViewOptions } from '../../editor-browser';
import { readClipboard, writeClipboard, type ClipboardFragment } from '../../extensions/clipboard';
import { plainText, type StarterNode } from '../../extensions/demo-model';
import { tablePlainText } from '../../extensions/table';
import { type Schema } from '../../model';
import { supportsOwnedText } from '../../owned-text-support';
import { TextSelection } from '../../state';
import type { TextFormat } from '../formatting';
import { tableCells } from '../table';
import { plainCellRectangle } from '../table-clipboard';
import { createStarterDocumentQuery } from './browser-document';
import type { TableFrame } from './table-view';
import type { EditorSession } from './types';

type InputOptions = {
  editor: EditorSession;
  onEdit: () => void;
  textInput: ReturnType<typeof createTextInput<StarterNode>>;
  input: () => HTMLTextAreaElement | null;
  notice: (message: string) => void;
  closePanel: () => void;
  escape: () => void;
  selectAll: () => void;
  navigate: (event: KeyboardEvent) => boolean;
};

/** Browser input policy for the starter-kit schema. Commands remain usable
 * without this adapter, a textarea, or React. */
export function createStarterKitInput({
  editor,
  onEdit,
  textInput,
  input,
  notice,
  closePanel,
  escape,
  selectAll,
  navigate,
}: InputOptions) {
  const project = createStarterDocumentQuery(editor.schema);
  const allocate = () => ({ id: editor.allocateBlockId(), key: crypto.randomUUID() });

  function run(action: () => boolean, focusAfter = false) {
    try {
      onEdit();
      const applied = action();
      notice('');

      if (!applied) syncInput();

      if (applied && focusAfter) editor.commands.focus();

      return applied;
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Command failed');
      syncInput();

      return false;
    }
  }

  function restore(redo = false) {
    return run(() => {
      const changed = redo ? editor.commands.redo() : editor.commands.undo();

      if (changed) closePanel();

      return changed;
    }, true);
  }

  const toggleFormat = (format: TextFormat) =>
    run(() => editor.commands.toggleFormat(format), true);

  const replaceCells = (text: string) => run(() => editor.commands.replaceSelection(text), true);
  const paste = (fragment: ClipboardFragment) => run(() => editor.commands.paste(fragment), true);

  const table: Pick<TableFrame, 'onText' | 'onUndo' | 'onFormat' | 'onReplace'> = {
    onText: (id, from, to, text, caret) =>
      run(() =>
        editor
          .chain({ history: { group: `typing:${id}` } })
          .replaceText({ id, from, to, text, caret })
          .run(),
      ),
    onUndo: restore,
    onFormat: toggleFormat,
    onReplace: replaceCells,
  };

  function syncInput() {
    const element = input();

    if (element) textInput.sync(element);
  }

  function replace(from: number, to: number, value: string, separate = false, paragraphs = false) {
    const selection = editor.state.selection;

    if (!(selection instanceof TextSelection)) {
      replaceCells(value);

      return;
    }

    function reject(message: string) {
      notice(message);
      syncInput();
    }

    const normalized = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replaceAll('\ufffc', '');
    const clean = paragraphs ? normalized : normalized.replace(/\n/g, ' ');

    if (!supportsOwnedText(clean)) {
      reject('This study currently supports Latin text.');

      return;
    }

    if (paragraphs && clean.includes('\n')) {
      if (run(() => editor.commands.pasteText(clean))) closePanel();

      return;
    }

    const history = separate
      ? 'separate'
      : {
          group: `${textInput.composing ? 'composition' : clean ? 'typing' : 'delete'}:${selection.head.id}`,
        };

    if (
      run(() => editor.chain({ history }).insertText(clean, { from, to }).run()) &&
      selection.anchor.id !== selection.head.id
    )
      closePanel();
  }

  function copyText() {
    const document = project(editor.state);
    const { tree } = document;

    return document.ranges
      .map((range) => {
        const node = tree.byId.get(range.id)?.node;

        if (!node) return '';

        return range.kind === 'text' && (node.kind === 'paragraph' || node.kind === 'heading')
          ? plainText(node, range.from, range.to)
          : nodeText(node, editor.schema);
      })
      .join('\n');
  }

  function key(event: KeyboardEvent) {
    if (event.isComposing || textInput.composing) return;

    if (
      !(editor.state.selection instanceof TextSelection) &&
      (event.key === 'Backspace' || event.key === 'Delete')
    ) {
      event.preventDefault();
      replaceCells('');

      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      restore(event.shiftKey);

      return;
    }

    if ((event.metaKey || event.ctrlKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      toggleFormat(
        event.key.toLowerCase() === 'b'
          ? 'bold'
          : event.key.toLowerCase() === 'i'
            ? 'italic'
            : 'underline',
      );

      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAll();

      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      escape();

      return;
    }

    if (navigate(event)) return;

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      run(() => {
        const selection = editor.state.selection;

        const chain = editor.chain({
          history:
            selection instanceof TextSelection
              ? { group: `delete:${selection.head.id}` }
              : 'separate',
        });

        return (event.key === 'Backspace' ? chain.deleteBackward() : chain.deleteForward()).run();
      });

      return;
    }

    if (event.key === 'Tab' && editor.queries.blockState().item !== undefined) {
      event.preventDefault();
      run(() => editor.commands.indentList(event.shiftKey), true);

      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      if (run(() => editor.commands.splitBlock())) closePanel();
    }
  }

  const inputEvents: NonNullable<BrowserViewOptions['input']> = {
    element: () => input(),
    keydown: key,
    compositionstart: textInput.compositionStart,
    compositionend: () => textInput.compositionEnd(input()),
    input: (_event, inputValue) => textInput.read(inputValue, replace),
    copy: (e) => {
      e.preventDefault();

      if (!e.clipboardData) return;

      try {
        writeClipboard(e.clipboardData, editor.schema, editor.state, copyText());
      } catch (error) {
        notice(error instanceof Error ? error.message : String(error));

        return;
      }
    },
    cut: (e) => {
      const { nonTextSelection, collapsed, start, end } = project(editor.state);
      e.preventDefault();

      if (!e.clipboardData) return;

      try {
        writeClipboard(e.clipboardData, editor.schema, editor.state, copyText());
      } catch (error) {
        notice(error instanceof Error ? error.message : String(error));

        return;
      }

      if (nonTextSelection) replaceCells('');
      else if (!collapsed && start && end) replace(start.offset, end.offset, '', true);
    },
    paste: (e) => {
      const editorState = editor.state;

      if (!e.clipboardData) return;

      try {
        const fragment = readClipboard(e.clipboardData);

        const rectangle =
          fragment?.nodes.length === 1 && fragment.nodes[0].kind === 'table'
            ? fragment.nodes[0]
            : null;

        const cellSelection = editorState.selection instanceof tableCells.CellSelection;

        // Native textareas retain ordinary text paste while the grid owns rectangles.
        if (
          !cellSelection &&
          !rectangle &&
          e.target instanceof HTMLTextAreaElement &&
          e.target !== input()
        )
          return;
        e.preventDefault();

        if (cellSelection) {
          let source = rectangle;

          if (!source) {
            source = plainCellRectangle(e.clipboardData.getData('text/plain'), allocate);

            if (fragment) {
              if (
                fragment.nodes.some((node) => node.kind !== 'paragraph' && node.kind !== 'heading')
              )
                throw new Error('Table cells currently support paragraphs and headings.');

              const paragraphs = fragment.nodes.filter(
                (node) => node.kind === 'paragraph' || node.kind === 'heading',
              );

              source = { ...source, rows: [[{ ...source.rows[0][0], paragraphs }]] };
            }
          }

          if (paste({ nodes: [source], inline: false })) closePanel();

          return;
        }

        if (fragment) {
          if (paste(fragment)) closePanel();
        } else {
          const { start, end } = project(editorState);

          if (start && end)
            replace(start.offset, end.offset, e.clipboardData.getData('text/plain'), true, true);
          else replaceCells(e.clipboardData.getData('text/plain'));
        }
      } catch (error) {
        e.preventDefault();
        notice(error instanceof Error ? error.message : String(error));
      }
    },
  };

  return { events: inputEvents, table };
}

/** A table's native textarea owns focus while editing a cell; otherwise focus
 * the canvas capture. This DOM convention belongs to the starter-kit view. */
export function focusStarterKitInput(
  root: HTMLElement | null,
  input: HTMLTextAreaElement | null,
  id?: number,
) {
  const cell =
    id === undefined
      ? null
      : root?.querySelector<HTMLTextAreaElement>(`textarea[data-text-block="${id}"]`);

  (cell ?? input)?.focus({ preventScroll: true });
}

function nodeText(node: StarterNode, schema: Schema<StarterNode>): string {
  return node.kind === 'paragraph' || node.kind === 'heading'
    ? plainText(node)
    : node.kind === 'image'
      ? node.alt
      : node.kind === 'table'
        ? tablePlainText(node)
        : schema
            .children(node)
            .map((child) => nodeText(child, schema))
            .join('\n');
}
