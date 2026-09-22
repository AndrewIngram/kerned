import {
  defineExtension,
  defineCommand,
  defineDocumentCommand,
  type DocumentCommandArguments,
} from '@gprose/core';
import { replaceText } from '@gprose/extension-document';
import { AllSelection } from '@gprose/state';

import { pasteFragment, type ClipboardFragment } from './clipboard-fragment.js';
import {
  replaceSelection,
  splitBlock,
  deleteBackward,
  deleteForward,
  insertText,
  pasteText,
} from './text-editing.js';

export interface UpdateNodeArguments extends DocumentCommandArguments {
  readonly args: [node: this['node']];
}

export interface PasteArguments extends DocumentCommandArguments {
  readonly args: [fragment: ClipboardFragment<this['node']>];
}

/** Document editing policies run against the current command draft, including nested edits. */
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

export const documentEditing = defineExtension({
  name: 'documentEditing',
  options: {},
  requires: ['paragraph', 'heading', 'list', 'quote', 'table'],
  setup: () => ({ commands: editingCommands }),
});
