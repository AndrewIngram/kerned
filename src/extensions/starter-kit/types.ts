import type { Editor } from '../../core';
import type { createOwnedEngine } from '../../owned-layout';
import type { StarterNode } from '../demo-model';
import type { starterExtensions } from './index';

export type Owned = Awaited<ReturnType<typeof createOwnedEngine>>;

export type EditorSession = Editor<typeof starterExtensions, StarterNode>;
