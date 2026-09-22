import * as Automerge from '@automerge/automerge';
import { indexTree, type NodeIdentity, type Schema } from '@gprose/model';

import { createAutomergePeer, type Changes } from './automerge.js';
import type { Edit } from './protocol.js';

export type PendingTextEdit = { sequence: number; before: string; edit: Edit };

type Outcome =
  | { sequence: number; kind: 'replayed'; message: Changes }
  | { sequence: number; kind: 'discarded'; reason: 'denied' | 'dependency' | 'changed-base' };

/** Reauthor pending intents on an accepted snapshot, with a fresh host-issued actor.
 * Returned changes still require admission. Original cursor identities are NOT remapped. */
export function recoverAutomergeEdits<N extends NodeIdentity>(options: {
  schema: Schema<N>;
  nodes: readonly N[];
  generation: string;
  seed: Uint8Array;
  base: Uint8Array;
  actor: string;
  pending: readonly PendingTextEdit[];
  denied: ReadonlySet<number>;
}) {
  // Detect operations, not just final string equality: replacing text with itself
  // changes character identity and must not silently retarget an old intent.
  const base = Automerge.load<{ texts: Record<string, string> }>(options.base);
  const changedObjects = new Set<string>();
  const changedKeys = new Set<string>();

  try {
    const accepted = Automerge.load<{ texts: Record<string, string> }>(options.seed);

    try {
      for (const change of Automerge.getChanges(base, accepted))
        for (const op of Automerge.decodeChange(change).ops) changedObjects.add(op.obj);

      for (const key of Object.keys(base.texts)) {
        const object = Automerge.getObjectId(base.texts, key);

        if (object !== null && changedObjects.has(object)) changedKeys.add(key);
      }
    } finally {
      Automerge.free(accepted);
    }
  } finally {
    Automerge.free(base);
  }

  const peer = createAutomergePeer(options);
  const blocked = new Set<string>();
  const outcomes: Outcome[] = [];

  try {
    let previous = 0;

    for (const pending of options.pending) {
      if (!Number.isSafeInteger(pending.sequence) || pending.sequence <= previous)
        throw new Error('Unordered pending intents');
      previous = pending.sequence;
      const { key } = pending.edit;
      const node = indexTree(options.schema, peer.nodes).byKey.get(key)?.node;

      const reason = options.denied.has(pending.sequence)
        ? 'denied'
        : blocked.has(key)
          ? 'dependency'
          : changedKeys.has(key) || !node || options.schema.text(node) !== pending.before
            ? 'changed-base'
            : null;

      if (reason) {
        blocked.add(key);
        outcomes.push({ sequence: pending.sequence, kind: 'discarded', reason });
      } else {
        outcomes.push({
          sequence: pending.sequence,
          kind: 'replayed',
          message: peer.edit(pending.edit),
        });
      }
    }

    return { peer, outcomes };
  } catch (error) {
    peer.destroy();
    throw error;
  }
}
