import { defineExtension, type ContributionContext } from '@gprose/core';
import { documentHtmlParsers } from '@gprose/extension-document/browser';
import { tableHtmlParsers } from '@gprose/extension-table/browser';
import { inputPolicies, htmlParsers, keyboardShortcuts } from '@gprose/view';

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
