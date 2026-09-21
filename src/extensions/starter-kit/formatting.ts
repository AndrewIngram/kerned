import { defineCommand, defineExtension, defineQuery } from '../../core';
import { toggleMarkCommand } from '../../state';
import type { TextFormat } from '../formatting';
import { formattingDefinitions } from '../starter-definitions';
import { textCommands } from '../text-commands';

/** Formatting follows text and mark capabilities, including custom text nodes. */
export const starterFormatting = defineExtension({
  name: 'starterFormatting',
  options: {},
  requires: formattingDefinitions.map((definition) => definition.name),
  setup: () => ({
    commands: {
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
    },
    queries: {
      formatting: defineQuery(({ schema, state }) => {
        const formatting = textCommands(schema, state);

        return { available: formatting.available, caret: formatting.caret };
      }),
      formatActivity: defineQuery(({ schema, state }, format: TextFormat) =>
        textCommands(schema, state).activity(format),
      ),
    },
  }),
});
