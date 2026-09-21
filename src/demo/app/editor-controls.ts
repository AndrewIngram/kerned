import type { ClipboardFragment } from '../../extensions/clipboard';
import type { StarterNode } from '../../extensions/demo-model';
import type { TextFormat } from '../../extensions/formatting';
import type { EditorSession } from '../../extensions/starter-kit/types';
import { TextSelection } from '../../state';

/** Demo feedback and focus wrap the editor's public commands; no document policy lives here. */
export function createEditorControls({
  editor,
  onEdit,
  notice,
  closePanel,
  syncInput,
}: {
  editor: EditorSession;
  onEdit: () => void;
  notice: (message: string) => void;
  closePanel: () => void;
  syncInput: () => void;
}) {
  function run(action: () => boolean, focusAfter = true) {
    try {
      onEdit();
      const applied = action();
      notice('');

      if (applied && focusAfter) editor.commands.focus();

      return applied;
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Command failed');
      syncInput();

      return false;
    }
  }

  return {
    replaceText: (id: number, from: number, to: number, text: string, caret: number) =>
      run(
        () =>
          editor
            .chain({ history: { group: `typing:${id}` } })
            .replaceText({ id, from, to, text, caret })
            .run(),
        false,
      ),
    allocate: () => ({ id: editor.allocateBlockId(), key: crypto.randomUUID() }),
    insertText: (
      text: string,
      range: { from: number; to: number },
      history: 'separate' | { group: string },
    ) => run(() => editor.chain({ history }).insertText(text, range).run(), false),
    pasteText: (text: string) => run(() => editor.commands.pasteText(text), false),
    splitBlock: () => run(() => editor.commands.splitBlock(), false),
    deleteText: (backward: boolean) =>
      run(() => {
        const selection = editor.state.selection;

        const chain = editor.chain({
          history:
            selection instanceof TextSelection
              ? { group: `delete:${selection.head.id}` }
              : 'separate',
        });

        return (backward ? chain.deleteBackward() : chain.deleteForward()).run();
      }, false),
    indentList: (outdent = false) => run(() => editor.commands.indentList(outdent)),
    toggleList: (ordered: boolean) => run(() => editor.commands.toggleList(ordered)),
    toggleQuote: () => run(() => editor.commands.toggleQuote()),
    toggleFormat: (format: TextFormat) => run(() => editor.commands.toggleFormat(format)),
    clearMarks: () => run(() => editor.commands.clearMarks()),
    setHeading: (level: 1 | 2 | 3 | 4 | null) => run(() => editor.commands.setHeading(level)),
    insertTable: () => run(() => editor.commands.insertTable()),
    changeTable: (column: boolean) =>
      run(() => (column ? editor.commands.addTableColumn() : editor.commands.addTableRow())),
    replaceCells: (text: string) => run(() => editor.commands.replaceSelection(text)),
    paste: (fragment: ClipboardFragment) => run(() => editor.commands.paste(fragment)),
    update: (node: StarterNode) => run(() => editor.commands.updateNode(node)),
    restore: (redo = false) =>
      run(() => {
        const changed = redo ? editor.redo() : editor.undo();

        if (changed) closePanel();

        return changed;
      }),
    formatPressed: (format: TextFormat) => {
      const activity = editor.queries.formatActivity(format);

      return activity === 'mixed' ? 'mixed' : activity === 'active';
    },
    get formatting() {
      return editor.queries.formatting();
    },
    get blocks() {
      return editor.queries.blockState();
    },
    selectedTable: () => editor.queries.selectedTable(),
  };
}

export type EditorControls = ReturnType<typeof createEditorControls>;
