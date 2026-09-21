import { defineExtension } from '../core';

/** Install one local undo history per session. */
export const localHistory = defineExtension({
  name: 'localHistory',
  options: { depth: 256, newGroupDelay: 750 },
  setup: (options) => ({ history: options }),
});
