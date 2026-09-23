import type { Editor } from '@kerned/core';
import type { starterExtensions } from '@kerned/starter-kit';

import type { StarterNode } from './demo-model.js';

type StarterSession = Editor<typeof starterExtensions, StarterNode>;

/** Consumers need starter capabilities, not an exact assembly tuple. */
export type EditorSession = Omit<StarterSession, 'schema'> & {
  readonly schema: Omit<StarterSession['schema'], 'definitions'>;
};
