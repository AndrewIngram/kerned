import type { ClipboardFragment } from '../../extensions/clipboard';
import type { StarterNode } from '../../extensions/demo-model';
import type { TextFormat } from '../../extensions/formatting';
import type { EditorSession } from '../../extensions/starter-kit/types';
import { TextSelection, type Selection, type Transaction } from '../../state';
import type { Step } from '../../transform';

/** Demo feedback and focus wrap the editor's public commands; no document policy lives here. */
export function createEditorControls({
  editor,
  onEdit,
  notice,
  closePanel,
  focus,
  syncInput,
}: {
  editor: EditorSession;
  onEdit: () => void;
  notice: (message: string) => void;
  closePanel: () => void;
  focus: () => void;
  syncInput: () => void;
}) {
  function run(action: () => boolean) {
    try {
      onEdit();
      const applied = action();
      notice('');

      if (applied) focus();

      return applied;
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Command failed');
      syncInput();

      return false;
    }
  }

  function dispatch(
    steps: Step<StarterNode>[],
    history: Transaction<StarterNode>['history'] = 'separate',
    selection?: Selection,
    input = false,
  ) {
    if (history === 'exclude') throw new Error('Local commands must declare a history group');

    try {
      onEdit();

      const applied = editor.transact(
        (context) => {
          if (input) {
            if (!(selection instanceof TextSelection))
              throw new Error('Text input requires a resulting caret');
            context.apply({ steps, selection, input: true });
          } else context.apply({ steps, selection });

          return true;
        },
        { history, time: Date.now() },
      );

      if (!applied) {
        syncInput();

        return false;
      }

      notice('');

      return true;
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Edit failed');
      syncInput();

      return false;
    }
  }

  return {
    dispatch,
    allocate: () => ({ id: editor.allocateBlockId(), key: crypto.randomUUID() }),
    structure: (change: () => Step<StarterNode>[]) =>
      run(() =>
        editor.transact((context) => {
          context.steps(change());

          return true;
        }),
      ),
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
