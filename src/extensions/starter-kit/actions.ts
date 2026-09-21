import { blockCommands, listCommands, replaceStructuredText } from '../../extensions/blocks';
import { type StarterNode } from '../../extensions/demo-model';
import { demoSchema } from '../../extensions/demo-schema';
import { formattingSchema, type TextFormat } from '../../extensions/formatting';
import { setTextBlockType } from '../../extensions/headings';
import { appendTableColumn, appendTableRow, createTable, tableCells } from '../../extensions/table';
import { textCommands } from '../../extensions/text-commands';
import {
  RangeSelection,
  NodeSelection,
  AllSelection,
  textSelection,
  toggleMarkCommand,
  type Selection,
  type Transaction,
} from '../../state';
import { type Step } from '../../transform';
import { pasteFragment } from '../clipboard';
import type { EditorDocument, EditorSession } from './types';

type ActionOptions = {
  editor: EditorSession;
  document: EditorDocument;
  onEdit: () => void;
  notice: (message: string) => void;
  closePanel: () => void;
  focus: (id?: number) => void;
  syncInput: () => void;
};

export function createStarterKitActions({
  editor,
  document,
  onEdit,
  notice,
  closePanel,
  focus,
  syncInput,
}: ActionOptions) {
  const { editorState, tree, textSelection: text, focusId, selectedBlocks } = document;

  function dispatch(
    steps: Step<StarterNode>[],
    history: Transaction<StarterNode>['history'] = 'separate',
    nextSelection?: Selection,
    input = false,
  ) {
    if (history === 'exclude') throw new Error('Local commands must declare a history group');

    try {
      editor.dispatch({
        baseRevision: editor.state.revision,
        origin: 'local',
        history,
        time: performance.now(),
        steps,
        selection: nextSelection,
        input,
      });
      onEdit();
      notice('');

      return true;
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Edit failed');
      syncInput();

      return false;
    }
  }

  function runCommand(
    steps: Step<StarterNode>[],
    nextSelection: Selection = editor.state.selection,
  ) {
    try {
      onEdit();
      const applied = editor.chain().steps(steps).select(nextSelection).run();
      notice(applied ? '' : 'Command is not available');

      return applied;
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Command failed');

      return false;
    }
  }

  const formatting = textCommands(demoSchema, editorState, tree);

  const formatPressed = (key: TextFormat) => {
    const value = formatting.activity(key);

    return value === 'mixed' ? 'mixed' : value === 'active';
  };

  function focusText() {
    focus(text?.head.id);
  }

  function toggleFormat(key: TextFormat) {
    if (!formatting.available) return;

    try {
      editor
        .chain()
        .command(toggleMarkCommand(demoSchema, formattingSchema.create(key, null)))
        .effect(focusText)
        .run();
    } catch (error) {
      notice(String(error));
    }
  }

  function clearMarks() {
    if (formatting.caret) editor.setStoredMarks([]);
    else runCommand(formatting.clear());
    focusText();
  }

  const allocate = () => ({ id: editor.allocateBlockId(), key: crypto.randomUUID() });

  const blocks = blockCommands(
    demoSchema,
    editorState,
    selectedBlocks.map((n) => n.id),
    allocate,
    tree,
  );

  function structure(action: () => Step<StarterNode>[]) {
    try {
      runCommand(action());
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Cannot change these blocks');
    }

    focus();
  }

  function indentList(outdent = false) {
    if (blocks.item === undefined) return;
    const id = blocks.item;
    structure(
      () =>
        (outdent ? listCommands.outdent : listCommands.indent)(
          demoSchema,
          editorState,
          id,
          allocate,
        ).steps,
    );
  }

  function toggleList(ordered: boolean) {
    structure(() => blocks.list(ordered));
  }

  function toggleQuote() {
    structure(() => blocks.quote());
  }

  function selectedTable() {
    let entry = tree.byId.get(
      editorState.selection instanceof tableCells.CellSelection
        ? editorState.selection.tableId
        : (focusId ?? -1),
    );

    while (entry) {
      if (entry.node.kind === 'table') return entry;
      entry = entry.parent === null ? undefined : tree.byId.get(entry.parent);
    }

    return undefined;
  }

  function changeTable(column: boolean) {
    const entry = selectedTable();

    if (!entry || entry.node.kind !== 'table') return;
    const table = entry.node;
    structure(() => [
      {
        kind: 'replaceChildren',
        parent: entry.parent,
        index: entry.index,
        count: 1,
        nodes: [(column ? appendTableColumn : appendTableRow)(table, allocate)],
      },
    ]);
  }

  function insertTable() {
    if (focusId === null) return;
    let entry = tree.byId.get(focusId);

    while (entry?.parent != null) entry = tree.byId.get(entry.parent);

    if (!entry) return;

    const table = createTable(allocate),
      after: StarterNode = { kind: 'paragraph', ...allocate(), text: '', marks: [], inline: [] };

    runCommand(
      [{ kind: 'insertChildren', parent: null, index: entry.index + 1, nodes: [table, after] }],
      textSelection(after.id, 0),
    );
  }

  function replaceCells(textValue: string) {
    try {
      const current = editor.state;

      const command =
        textValue &&
        (current.selection instanceof NodeSelection ||
          current.selection instanceof AllSelection ||
          (current.selection instanceof RangeSelection &&
            (!current.selection.ranges(document.context).some((range) => range.kind === 'text') ||
              textValue.includes('\n'))))
          ? pasteFragment(
              demoSchema,
              current,
              {
                inline: false,
                nodes: textValue.split(/\r?\n/).map((value) => ({
                  kind: 'paragraph',
                  ...allocate(),
                  text: value,
                  marks: [],
                  inline: [],
                })),
              },
              allocate,
            )
          : current.selection instanceof RangeSelection
            ? replaceStructuredText(demoSchema, current, textValue)
            : editor.selectionEdit(textValue);

      dispatch(command.steps, 'separate', command.selection);
    } catch (error) {
      notice(String(error));
    }
  }

  function setHeading(level: 1 | 2 | 3 | 4 | null) {
    const steps = setTextBlockType(
      demoSchema,
      editorState,
      selectedBlocks.map((n) => n.id),
      level,
      tree,
    );

    runCommand(steps);
    focus();
  }

  function update(node: StarterNode) {
    dispatch([{ kind: 'updateBlock', node }]);
  }

  function restore(redo = false) {
    const result = redo ? editor.redo() : editor.undo();

    if (!result) return;
    onEdit();
    closePanel();
    focus();
  }

  return {
    indentList,
    toggleList,
    toggleQuote,
    dispatch,
    formatting,
    formatPressed,
    toggleFormat,
    clearMarks,
    allocate,
    blocks,
    structure,
    selectedTable,
    changeTable,
    insertTable,
    replaceCells,
    setHeading,
    update,
    restore,
  };
}

export type StarterActions = ReturnType<typeof createStarterKitActions>;
