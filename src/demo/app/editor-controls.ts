import type { TextFormat } from '../../extensions/formatting';
import type { EditorSession } from '../../extensions/starter-kit/types';

/** Demo feedback and focus wrap the editor's public commands; no document policy lives here. */
export function createEditorControls({
  editor,
  onEdit,
  notice,
  closePanel,
}: {
  editor: EditorSession;
  onEdit: () => void;
  notice: (message: string) => void;
  closePanel: () => void;
}) {
  function run(action: () => boolean) {
    try {
      onEdit();
      const applied = action();
      notice('');

      if (applied) editor.commands.focus();

      return applied;
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Command failed');

      return false;
    }
  }

  return {
    indentList: (outdent = false) => run(() => editor.commands.indentList(outdent)),
    toggleList: (ordered: boolean) => run(() => editor.commands.toggleList(ordered)),
    toggleQuote: () => run(() => editor.commands.toggleQuote()),
    toggleFormat: (format: TextFormat) => run(() => editor.commands.toggleFormat(format)),
    clearMarks: () => run(() => editor.commands.clearMarks()),
    setHeading: (level: 1 | 2 | 3 | 4 | null) => run(() => editor.commands.setHeading(level)),
    insertTable: () => run(() => editor.commands.insertTable()),
    changeTable: (column: boolean) =>
      run(() => (column ? editor.commands.addTableColumn() : editor.commands.addTableRow())),
    restore: (redo = false) =>
      run(() => {
        const changed = redo ? editor.commands.redo() : editor.commands.undo();

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
