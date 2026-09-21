import type { Editor } from '../../core';
import type { StarterNode } from '../demo-model';
import type { starterExtensions } from './index';

type StarterSession = Editor<typeof starterExtensions, StarterNode>;

/** Consumers need starter capabilities, not an exact assembly tuple. */
export type EditorSession = Omit<StarterSession, 'schema'> & {
  readonly schema: Omit<StarterSession['schema'], 'definitions'>;
};
