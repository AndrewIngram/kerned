import type { Editor } from '../../core';
import type { createOwnedEngine } from '../../owned-layout';
import type { StarterNode } from '../demo-model';
import type { starterExtensions } from './index';

export type Owned = Awaited<ReturnType<typeof createOwnedEngine>>;

type StarterSession = Editor<typeof starterExtensions, StarterNode>;

/** Consumers need starter capabilities, not an exact assembly tuple. */
export type EditorSession = Omit<StarterSession, 'schema'> & {
  readonly schema: Omit<StarterSession['schema'], 'definitions'>;
};
