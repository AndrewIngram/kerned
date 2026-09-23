import { defineCommand, defineExtension, defineQuery } from '@kerned/core';
import { toggleMarkCommand } from '@kerned/state';

import { formattingDefinitions } from './definitions.js';
import type { TextFormat } from './formatting.js';
import { textCommands } from './text-commands.js';

/** Formatting follows text and mark capabilities, including custom text nodes. */
export const formattingCommands = {
  toggleFormat: defineCommand({
    execute(context, format: TextFormat) {
      return context.command(toggleMarkCommand(context.schema, { type: format, attrs: null }));
    },
    activity: ({ schema, state }, format: TextFormat) =>
      textCommands(schema, state).activity(format),
  }),
  clearMarks: defineCommand({
    execute(context) {
      const formatting = textCommands(context.schema, context.state);

      if (!formatting.available) return false;

      if (formatting.caret) context.storedMarks([]);
      else context.steps(formatting.clear());

      return true;
    },
  }),
};

export const formattingQueries = {
  formatting: defineQuery(({ schema, state }) => {
    const formatting = textCommands(schema, state);

    return { available: formatting.available, caret: formatting.caret };
  }),
  formatActivity: defineQuery(({ schema, state }, format: TextFormat) =>
    textCommands(schema, state).activity(format),
  ),
};

export const documentFormatting = defineExtension({
  name: 'documentFormatting',
  options: {},
  requires: formattingDefinitions.map((definition) => definition.name),
  setup: () => ({
    commands: formattingCommands,
    queries: formattingQueries,
  }),
});
