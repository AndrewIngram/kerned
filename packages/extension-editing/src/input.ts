import { createEditorSerializer, createInputRules } from '@gprose/core';
import { image } from '@gprose/extension-document';
import { table as tableDefinition, tableCell } from '@gprose/extension-table';
import { tableCells } from '@gprose/extension-table';
import { plainCellRectangle, cellRectangleText } from '@gprose/extension-table';
import { textContent, type NodeIdentity, type Schema } from '@gprose/model';
import { TextSelection } from '@gprose/state';
import {
  createEditorHtmlParser,
  createTextInput,
  type InputHandlers,
  type ViewSession,
} from '@gprose/view';
import { createDocumentQuery } from '@gprose/view';
import { supportsLayoutText } from '@gprose/view/text';

import type { ClipboardFragment } from './clipboard-fragment.js';
import { readClipboard, writeClipboard } from './clipboard.js';
import { editingCommands } from './commands.js';
import { structureCommands, structureQueries } from './structure.js';

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
export function createDocumentInput<N extends NodeIdentity>({
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
  const rules = createInputRules(editor);
  const afterComposition = () => applyRules(() => rules.endComposition());
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

  const replaceCells = (text: string) =>
    run(
      () => editor.transact((context) => context.command(editingCommands.replaceSelection, text)),
      true,
    );

  const paste = (fragment: ClipboardFragment<N>) =>
    run(() => editor.transact((context) => editingCommands.paste.execute(context, fragment)), true);

  function applyRules(action: () => boolean) {
    try {
      if (action()) syncInput();
    } catch (error) {
      notice?.(error instanceof Error ? error.message : 'Input rule failed');
      syncInput();
    }
  }

  function syncInput() {
    const element = input();

    if (element) textInput.sync(element);
  }

  function replace(
    from: number,
    to: number,
    value: string,
    {
      separate = false,
      paragraphs = false,
      composing = textInput.composing,
      pasted = false,
    }: {
      separate?: boolean;
      paragraphs?: boolean;
      composing?: boolean;
      pasted?: boolean;
    } = {},
  ) {
    const selection = editor.state.selection;

    if (!(selection instanceof TextSelection)) {
      if (replaceCells(value) && !separate && !paragraphs && !pasted)
        applyRules(() => rules.input({ text: value, composing }));

      return;
    }

    function reject(message: string) {
      notice?.(message);
      syncInput();
    }

    const normalized = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replaceAll('\ufffc', '');
    const clean = paragraphs ? normalized : normalized.replace(/\n/g, ' ');

    if (!supportsLayoutText(clean)) {
      reject('This text contains a script or control character the editor does not yet support.');

      return;
    }

    if (paragraphs && clean.includes('\n')) {
      if (
        run(() => editor.transact((context) => context.command(editingCommands.pasteText, clean)))
      )
        closePanel?.();

      return;
    }

    const history =
      separate || pasted
        ? 'separate'
        : {
            group: `${composing ? 'composition' : clean ? 'typing' : 'delete'}:${selection.head.id}`,
          };

    const applied = run(() =>
      editor.transact(
        (context) => context.command(editingCommands.insertText, clean, { from, to }),
        { history },
      ),
    );

    if (applied) {
      if (!separate && !paragraphs && !pasted)
        applyRules(() => rules.input({ text: clean, composing }));

      if (selection.anchor.id !== selection.head.id) closePanel?.();
    }
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

  const inputEvents: InputHandlers = {
    keydown: key,
    input: (event, inputValue) =>
      textInput.read(inputValue, (from, to, text) =>
        replace(from, to, text, {
          composing: textInput.composing || (event instanceof InputEvent && event.isComposing),
          pasted:
            event instanceof InputEvent &&
            ['insertFromPaste', 'insertFromDrop'].includes(event.inputType),
        }),
      ),
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
      else if (!collapsed && start && end)
        replace(start.offset, end.offset, '', { separate: true });
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
            replace(start.offset, end.offset, e.clipboardData.getData('text/plain'), {
              separate: true,
              paragraphs: true,
            });
          else replaceCells(e.clipboardData.getData('text/plain'));
        }
      } catch (error) {
        e.preventDefault();
        notice?.(error instanceof Error ? error.message : String(error));
      }
    },
  };

  return { events: inputEvents, afterComposition };
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
