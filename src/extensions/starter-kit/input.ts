import { boundaries, TextSelection, textSelection, type Step } from '../../editor';
import { createTextInput, type BrowserViewOptions } from '../../editor-browser';
import { listCommands, replaceStructuredText } from '../../extensions/blocks';
import { pasteFragment, readClipboard, writeClipboard } from '../../extensions/clipboard';
import { plainText, type StarterNode } from '../../extensions/demo-model';
import { demoSchema } from '../../extensions/demo-schema';
import { pasteParagraphs } from '../../extensions/paste';
import { tablePlainText } from '../../extensions/table';
import { supportsOwnedText } from '../../owned-text-support';
import { tableCells } from '../table';
import { pasteCellRectangle, plainCellRectangle } from '../table-clipboard';
import type { StarterActions } from './actions';
import type { EditorDocument, EditorSession } from './types';

type InputOptions = {
  editor: EditorSession;
  document: EditorDocument;
  actions: StarterActions;
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
  document,
  actions,
  textInput,
  input,
  notice,
  closePanel,
  escape,
  selectAll,
  navigate,
}: InputOptions) {
  const {
    editorState,
    tree,
    nodes,
    textSelection: selection,
    nonTextSelection,
    start,
    end,

    crossNode,
    collapsed,
    active,
  } = document;

  const { dispatch, allocate, blocks, structure, restore, toggleFormat, replaceCells } = actions;

  function syncInput() {
    const element = input();

    if (element) textInput.sync(element);
  }

  function replace(from: number, to: number, value: string, separate = false, paragraphs = false) {
    if (!selection || !start || !end) {
      replaceCells(value);

      return;
    }

    if (active?.kind !== 'paragraph' && active?.kind !== 'heading') return;

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
      const command = pasteParagraphs(demoSchema, editorState, clean, allocate);
      dispatch(command.steps, 'separate', command.selection);
      closePanel();

      return;
    }

    if (crossNode) {
      const command = replaceStructuredText(demoSchema, editorState, clean);

      const history = separate
        ? 'separate'
        : {
            group: `${textInput.composing ? 'composition' : clean ? 'typing' : 'delete'}:${start.id}`,
          };

      dispatch(command.steps, history, command.selection, true);
      closePanel();

      return;
    }

    const nextSelection = textSelection(active.id, from + clean.length);

    const history = separate
      ? 'separate'
      : {
          group: `${textInput.composing ? 'composition' : clean ? 'typing' : 'delete'}:${active.id}`,
        };

    dispatch(
      [{ kind: 'replaceText', id: active.id, from, to, text: clean }],
      history,
      nextSelection,
      true,
    );
  }

  function copyText() {
    return document.ranges
      .map((range) => {
        const node = tree.byId.get(range.id)?.node;

        if (!node) return '';

        return range.kind === 'text' && (node.kind === 'paragraph' || node.kind === 'heading')
          ? plainText(node, range.from, range.to)
          : nodeText(node);
      })
      .join('\n');
  }

  function key(event: KeyboardEvent) {
    if (event.isComposing || textInput.composing) return;

    if (nonTextSelection && (event.key === 'Backspace' || event.key === 'Delete')) {
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

    if (!selection) return;

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();

      if (crossNode) {
        replace(0, 0, '', true);

        return;
      }

      let from = Math.min(selection.anchor.offset, selection.head.offset),
        to = Math.max(selection.anchor.offset, selection.head.offset);

      if (from === to && (active?.kind === 'paragraph' || active?.kind === 'heading')) {
        const b = boundaries(active.text),
          i = b.indexOf(from);

        if (event.key === 'Backspace') from = b[Math.max(0, i - 1)];
        else to = b[Math.min(b.length - 1, i + 1)];
      }

      if (from === to && (active?.kind === 'paragraph' || active?.kind === 'heading')) {
        const index = nodes.findIndex((n) => n.id === active.id),
          back = event.key === 'Backspace';

        if (back && blocks.item !== undefined) {
          try {
            const command = listCommands.backspace(demoSchema, editorState, active.id, allocate);
            dispatch(command.steps, 'separate', command.selection);
          } catch (error) {
            notice(String(error));
          }

          return;
        }

        const neighbour = nodes[index + (back ? -1 : 1)];

        if (
          (neighbour?.kind === 'paragraph' || neighbour?.kind === 'heading') &&
          (back ? from === 0 : to === active.text.length)
        ) {
          const left = back ? neighbour : active,
            right = back ? active : neighbour,
            at = left.text.length;

          dispatch(
            [{ kind: 'join', left: left.id, right: right.id }],
            'separate',
            textSelection(left.id, at),
          );

          return;
        }
      }

      if (from !== to) replace(from, to, '');
    }

    if (event.key === 'Tab' && blocks.item !== undefined) {
      event.preventDefault();
      structure(
        () =>
          (event.shiftKey ? listCommands.outdent : listCommands.indent)(
            demoSchema,
            editorState,
            blocks.item!,
            allocate,
          ).steps,
      );

      return;
    }

    if (event.key === 'Enter' && (active?.kind === 'paragraph' || active?.kind === 'heading')) {
      if (collapsed && blocks.item !== undefined) {
        event.preventDefault();

        try {
          const command = listCommands.enter(
            demoSchema,
            editorState,
            active.id,
            selection.head.offset,
            allocate,
          );

          dispatch(command.steps, 'separate', command.selection);
        } catch (error) {
          notice(String(error));
        }

        return;
      }

      const parent = tree.byId.get(active.id)?.parent;

      if (
        collapsed &&
        !active.text &&
        parent != null &&
        tree.byId.get(parent)?.node.kind === 'quote'
      ) {
        event.preventDefault();
        structure(() => [{ kind: 'unwrap', id: parent }]);

        return;
      }

      event.preventDefault();
      const rightId = editor.allocateBlockId();

      const command = collapsed
        ? { steps: [], selection }
        : replaceStructuredText(demoSchema, editorState, '');

      const caret = command.selection;

      if (!(caret instanceof TextSelection))
        throw new Error('Text replacement must return a caret');

      const steps: Step<StarterNode>[] = [
        ...command.steps,
        {
          kind: 'split',
          id: caret.head.id,
          at: caret.head.offset,
          rightId,
          rightKey: crypto.randomUUID(),
        },
      ];

      dispatch(steps, 'separate', textSelection(rightId, 0), true);
      closePanel();
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
        writeClipboard(e.clipboardData, demoSchema, editorState, copyText());
      } catch (error) {
        notice(error instanceof Error ? error.message : String(error));

        return;
      }
    },
    cut: (e) => {
      e.preventDefault();

      if (!e.clipboardData) return;

      try {
        writeClipboard(e.clipboardData, demoSchema, editorState, copyText());
      } catch (error) {
        notice(error instanceof Error ? error.message : String(error));

        return;
      }

      if (nonTextSelection) replaceCells('');
      else if (!collapsed && start && end) replace(start.offset, end.offset, '', true);
    },
    paste: (e) => {
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

          const command = pasteCellRectangle(demoSchema, editorState, source, allocate);

          if (command) {
            dispatch(command.steps, 'separate', command.selection);
            closePanel();
          }

          return;
        }

        if (fragment) {
          const command = pasteFragment(demoSchema, editorState, fragment, allocate);
          dispatch(command.steps, 'separate', command.selection);
          closePanel();
        } else if (start && end)
          replace(start.offset, end.offset, e.clipboardData.getData('text/plain'), true, true);
        else replaceCells(e.clipboardData.getData('text/plain'));
      } catch (error) {
        e.preventDefault();
        notice(error instanceof Error ? error.message : String(error));
      }
    },
  };

  return inputEvents;
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

function nodeText(node: StarterNode): string {
  return node.kind === 'paragraph' || node.kind === 'heading'
    ? plainText(node)
    : node.kind === 'image'
      ? node.alt
      : node.kind === 'table'
        ? tablePlainText(node)
        : node.kind === 'checklist'
          ? node.notes || '[Checklist]'
          : demoSchema.children(node).map(nodeText).join('\n');
}
