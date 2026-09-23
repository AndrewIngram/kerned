import { defineExtension, type ContributionContext } from '@kerned/core';
import { documentHtmlParsers } from '@kerned/extension-document/browser';
import { tableHtmlParsers } from '@kerned/extension-table/browser';
import { inputPolicies, htmlParsers, keyboardShortcuts } from '@kerned/view';

import { createDocumentInput } from './input.js';
import { documentKeyboardShortcuts } from './shortcuts.js';

export { readClipboard, writeClipboard } from './clipboard.js';

/** Schema-specific editing policy installed through the same composed session. */
export const documentInput = defineExtension({
  name: 'documentInput',
  requires: ['documentEditing', 'documentFormatting', 'documentStructure', 'tableEditing'],
  options: {},
  setup(_options, context: ContributionContext) {
    for (const shortcut of documentKeyboardShortcuts) context.provide(keyboardShortcuts, shortcut);

    for (const rule of [...documentHtmlParsers, ...tableHtmlParsers])
      context.provide(htmlParsers, rule);

    context.provide(inputPolicies, {
      create({ editor, input, textInput, selectAll, navigate, notice }) {
        const adapter = createDocumentInput({
          editor,
          input: () => input,
          textInput,
          selectAll,
          navigate,
          notice,
        });

        return { ...adapter.events, afterComposition: adapter.afterComposition };
      },
    });

    return {};
  },
});
