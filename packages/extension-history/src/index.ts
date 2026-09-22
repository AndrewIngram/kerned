import { defineExtension, defineCommand } from '@gprose/core';

/** Install one local undo history per session. */
export const localHistory = defineExtension({
  name: 'localHistory',
  options: { depth: 256, newGroupDelay: 750 },
  setup: (options) => ({
    history: options,
    commands: {
      undo: defineCommand({ execute: (context) => context.restoreHistory('undo') }),
      redo: defineCommand({ execute: (context) => context.restoreHistory('redo') }),
    },
  }),
});
