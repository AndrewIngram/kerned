import { createEditorSerializer } from '../../core';
import {
  createEditorHtmlParser,
  createTextInput,
  type BrowserViewOptions,
  type ViewSession,
} from '../../editor-browser';
import { createDocumentQuery } from '../../editor-browser/document';
import { readClipboard, writeClipboard, type ClipboardFragment } from '../../extensions/clipboard';
import { textContent, type NodeIdentity, type Schema } from '../../model';
import { supportsOwnedText } from '../../owned-text-support';
import { TextSelection } from '../../state';
import type { TextFormat } from '../formatting';
import { table as tableDefinition, tableCell, image } from '../starter-definitions';
import { tableCells } from '../table';
import { plainCellRectangle, cellRectangleText } from '../table-clipboard';
import { editingCommands } from './commands';
import { formattingCommands } from './formatting';
import { structureCommands, structureQueries } from './structure';

type InputOptions<N extends NodeIdentity> = {
  editor: ViewSession<N>;
  onEdit?: () => void;
  textInput: ReturnType<typeof createTextInput<N>>;
  input: () => HTMLTextAreaElement | null;
  notice?: (message: string) => void;
  closePanel?: () => void;
  escape?: () => void;
  selectAll: () => void;
  navigate: (event: KeyboardEvent) => boolean;
};

/** Browser input policy for the starter-kit schema. Commands remain usable
 * without this adapter, a textarea, or React. */
export function createStarterKitInput<N extends NodeIdentity>({
  editor,
  onEdit,
  textInput,
  input,
  notice,
  closePanel,
  escape,
  selectAll,
  navigate,
}: InputOptions<N>) {
  const tableType = editor.schema.node(tableDefinition);
  const serializer = createEditorSerializer(editor, { unsupported: 'text' });
  const parser = createEditorHtmlParser(editor);

  const project = createDocumentQuery<N, N, null>(editor.schema, {
    initial: null,
    isBlock: (node): node is N =>
      editor.schema.resolve(node).kind !== 'container' || tableType.matches(node),
    child: () => null,
  });

  const allocate = () => ({ id: editor.allocateBlockId(), key: crypto.randomUUID() });

  function run(action: () => boolean, focusAfter = false) {
    try {
      onEdit?.();
      const applied = action();
      notice?.('');

      if (!applied) syncInput();

      if (applied && focusAfter) editor.commands.focus();

      return applied;
    } catch (error) {
      notice?.(error instanceof Error ? error.message : 'Command failed');
      syncInput();

      return false;
    }
  }

  function restore(redo = false) {
    return run(() => {
      const changed = editor.transact((context) => context.restoreHistory(redo ? 'redo' : 'undo'));

      if (changed) closePanel?.();

      return changed;
    }, true);
  }

  const toggleFormat = (format: TextFormat) =>
    run(
      () => editor.transact((context) => context.command(formattingCommands.toggleFormat, format)),
      true,
    );

  const replaceCells = (text: string) =>
    run(
      () => editor.transact((context) => context.command(editingCommands.replaceSelection, text)),
      true,
    );

  const paste = (fragment: ClipboardFragment<N>) =>
    run(() => editor.transact((context) => editingCommands.paste.execute(context, fragment)), true);

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
      notice?.(message);
      syncInput();
    }

    const normalized = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replaceAll('\ufffc', '');
    const clean = paragraphs ? normalized : normalized.replace(/\n/g, ' ');

    if (!supportsOwnedText(clean)) {
      reject('This study currently supports Latin text.');

      return;
    }

    if (paragraphs && clean.includes('\n')) {
      if (
        run(() => editor.transact((context) => context.command(editingCommands.pasteText, clean)))
      )
        closePanel?.();

      return;
    }

    const history = separate
      ? 'separate'
      : {
          group: `${textInput.composing ? 'composition' : clean ? 'typing' : 'delete'}:${selection.head.id}`,
        };

    if (
      run(() =>
        editor.transact(
          (context) => context.command(editingCommands.insertText, clean, { from, to }),
          { history },
        ),
      ) &&
      selection.anchor.id !== selection.head.id
    )
      closePanel?.();
  }

  function copyText() {
    const document = project(editor.state);
    const { tree } = document;

    return document.ranges
      .map((range) => {
        const node = tree.byId.get(range.id)?.node;

        if (!node) return '';

        return range.kind === 'text' && editor.schema.text(node) !== null
          ? textContent(editor.schema, node, range.from, range.to)
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

    if (event.key === 'Escape' && escape) {
      event.preventDefault();
      escape?.();

      return;
    }

    if (navigate(event)) return;

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      run(() => {
        const selection = editor.state.selection;

        return editor.transact(
          (context) =>
            context.command(
              event.key === 'Backspace'
                ? editingCommands.deleteBackward
                : editingCommands.deleteForward,
            ),
          {
            history:
              selection instanceof TextSelection
                ? { group: `delete:${selection.head.id}` }
                : 'separate',
          },
        );
      });

      return;
    }

    if (
      event.key === 'Tab' &&
      structureQueries.blockState({ schema: editor.schema, state: editor.state }).item !== undefined
    ) {
      event.preventDefault();
      run(
        () =>
          editor.transact((context) =>
            context.command(structureCommands.indentList, event.shiftKey),
          ),
        true,
      );

      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      if (run(() => editor.transact((context) => context.command(editingCommands.splitBlock))))
        closePanel?.();
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
        writeClipboard(e.clipboardData, editor.schema, editor.state, copyText(), serializer);
      } catch (error) {
        notice?.(error instanceof Error ? error.message : String(error));

        return;
      }
    },
    cut: (e) => {
      const { nonTextSelection, collapsed, start, end } = project(editor.state);
      e.preventDefault();

      if (!e.clipboardData) return;

      try {
        writeClipboard(e.clipboardData, editor.schema, editor.state, copyText(), serializer);
      } catch (error) {
        notice?.(error instanceof Error ? error.message : String(error));

        return;
      }

      if (nonTextSelection) replaceCells('');
      else if (!collapsed && start && end) replace(start.offset, end.offset, '', true);
    },
    paste: (e) => {
      const editorState = editor.state;

      if (!e.clipboardData) return;

      try {
        const fragment = readClipboard(e.clipboardData, editor.schema, parser);

        const rectangle =
          fragment?.nodes.length === 1 && tableType.matches(fragment.nodes[0])
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
            source = plainCellRectangle(
              editor.schema,
              e.clipboardData.getData('text/plain'),
              allocate,
            );

            if (fragment) {
              if (fragment.nodes.some((node) => editor.schema.text(node) === null))
                throw new Error('Table cells currently support text blocks.');
              const first = editor.schema.children(source)[0];
              const cellType = editor.schema.node(tableCell);
              const attrs = first && cellType.read(first);

              if (!attrs) throw new Error('Expected a clipboard table cell');
              const cell = cellType.create(first, attrs, fragment.nodes);
              source = tableType.create(source, { caption: '' }, [cell]);
            }
          }

          if (paste({ nodes: [source], inline: false })) closePanel?.();

          return;
        }

        if (fragment) {
          if (paste(fragment)) closePanel?.();
        } else {
          const { start, end } = project(editorState);

          if (start && end)
            replace(start.offset, end.offset, e.clipboardData.getData('text/plain'), true, true);
          else replaceCells(e.clipboardData.getData('text/plain'));
        }
      } catch (error) {
        e.preventDefault();
        notice?.(error instanceof Error ? error.message : String(error));
      }
    },
  };

  return { events: inputEvents };
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

function nodeText<N extends NodeIdentity>(node: N, schema: Schema<N>): string {
  if (schema.text(node) !== null) return textContent(schema, node);
  const type = schema.resolve(node);

  if (type.name === image.name) return schema.node(image).read(node)?.alt ?? '';

  if (type.name === tableDefinition.name) {
    const caption = schema.node(tableDefinition).read(node)?.caption;
    const text = cellRectangleText(schema, node);

    return caption ? `${caption}\n${text}` : text;
  }

  return schema
    .children(node)
    .map((child) => nodeText(child, schema))
    .join('\n');
}
