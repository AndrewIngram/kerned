import {
  defineExtension,
  defineCommand,
  defineDocumentCommand,
  type DocumentCommandArguments,
} from '../../core';
import { AllSelection } from '../../state';
import { pasteFragment, type ClipboardFragment } from '../clipboard';
import {
  replaceSelection,
  splitBlock,
  deleteBackward,
  deleteForward,
  insertText,
  pasteText,
  replaceText,
} from './text-editing';

export interface UpdateNodeArguments extends DocumentCommandArguments {
  readonly args: [node: this['node']];
}

export interface PasteArguments extends DocumentCommandArguments {
  readonly args: [fragment: ClipboardFragment<this['node']>];
}

/** Starter policies run against the current command draft, including nested edits. */
export const editingCommands = {
  updateNode: defineDocumentCommand<UpdateNodeArguments>({
    execute(context, node) {
      context.step({ kind: 'updateBlock', node });

      return true;
    },
  }),
  selectAll: defineCommand({
    execute(context) {
      context.select(new AllSelection());

      return true;
    },
  }),
  replaceSelection,
  insertText,
  replaceText,
  pasteText,
  splitBlock,
  deleteBackward,
  deleteForward,
  paste: defineDocumentCommand<PasteArguments>({
    execute(context, fragment) {
      const change = pasteFragment(context.schema, context.state, fragment, () =>
        context.allocate(),
      );

      context.apply(change);

      return true;
    },
  }),
};

export const starterEditing = defineExtension({
  name: 'starterEditing',
  options: {},
  requires: ['paragraph', 'heading', 'list', 'quote', 'table'],
  setup: () => ({ commands: editingCommands }),
});
