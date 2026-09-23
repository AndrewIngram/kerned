import * as Automerge from '@automerge/automerge';
import { indexTree, type NodeIdentity, type Schema } from '@kerned/model';
import { z } from 'zod';

import { createAutomergePeer, type Changes } from './automerge.js';

type Decision =
  | { kind: 'accepted'; hash: string }
  | { kind: 'deferred'; reason: 'dependencies' }
  | {
      kind: 'rejected';
      reason:
        | 'generation'
        | 'batch'
        | 'invalid'
        | 'actor'
        | 'identity'
        | 'permission'
        | 'unsupported'
        | 'closed';
    };

/** Fixed-tree text admission experiment. Host binds authenticated principals to
 * fresh actor IDs. A successful receipt is required before broadcasting a change. */
export function createAutomergeAuthority<N extends NodeIdentity>(options: {
  schema: Schema<N>;
  nodes: readonly N[];
  generation: string;
  seed: Uint8Array;
  canEdit: (principal: string, node: N) => boolean;
}) {
  const { schema, generation } = options;
  let doc = Automerge.load<{ texts: Record<string, string> }>(options.seed);
  let nodes = options.nodes;
  const tree = indexTree(schema, nodes);
  const objects = new Map<string, string[]>();

  const actors = new Set(
    Automerge.getAllChanges(doc).map((change) => Automerge.decodeChange(change).actor),
  );

  const identities = new Map<string, string>();
  const receipts = new Map<string, Decision>();

  try {
    const projection = createAutomergePeer({ ...options, actor: Automerge.getActorId(doc) });
    nodes = projection.nodes;
    projection.destroy();

    for (const entry of tree.order) {
      if (schema.text(entry.node) === null) continue;
      const id = Automerge.getObjectId(doc.texts, entry.node.key);

      if (id === null) throw new Error('Missing text object');
      const ancestors = [entry.node.key];
      let parent = entry.parent;

      while (parent !== null) {
        const ancestor = tree.byId.get(parent);

        if (!ancestor) throw new Error('Missing parent');
        ancestors.push(ancestor.node.key);
        parent = ancestor.parent;
      }

      objects.set(id, ancestors);
    }
  } catch (error) {
    Automerge.free(doc);
    throw error;
  }

  return {
    get nodes() {
      return nodes;
    },
    save() {
      return Automerge.save(doc);
    },
    connect(principal: string, actor: string) {
      if (!/^(?:[0-9a-f]{2})+$/.test(actor)) throw new Error('Invalid actor');

      if (actors.has(actor)) throw new Error('Actor already used');
      actors.add(actor);
      let closed = false;

      return {
        submit(message: Changes): Decision {
          if (closed) return { kind: 'rejected', reason: 'closed' };

          if (message.generation !== generation) return { kind: 'rejected', reason: 'generation' };

          if (message.changes.length !== 1) return { kind: 'rejected', reason: 'batch' };
          let change: Automerge.DecodedChange;

          try {
            change = Automerge.decodeChange(message.changes[0]);
          } catch {
            return { kind: 'rejected', reason: 'invalid' };
          }

          if (change.actor !== actor) return { kind: 'rejected', reason: 'actor' };
          const identity = `${actor}/${change.seq}`;
          const previous = identities.get(identity);

          if (previous && previous !== change.hash) return { kind: 'rejected', reason: 'identity' };
          identities.set(identity, change.hash);
          const receipt = receipts.get(change.hash);

          if (receipt) return structuredClone(receipt);

          const reject = (reason: 'permission' | 'unsupported' | 'invalid'): Decision => {
            const result = { kind: 'rejected', reason } as const;
            receipts.set(change.hash, result);

            return result;
          };

          const currentTree = indexTree(schema, nodes);

          for (const op of change.ops) {
            const affected = objects.get(op.obj);

            if (
              !affected ||
              (op.action !== 'del' && op.action !== 'set') ||
              (op.action === 'set' &&
                (!z.string().safeParse(op.value).success || op.datatype !== undefined))
            )
              return reject('unsupported');

            if (
              affected.some((key) => {
                const entry = currentTree.byKey.get(key);

                return !entry || !options.canEdit(principal, entry.node);
              })
            )
              return reject('permission');
          }

          if (!Automerge.hasHeads(doc, change.deps))
            return { kind: 'deferred', reason: 'dependencies' };
          let candidate = Automerge.clone(doc);

          try {
            [candidate] = Automerge.applyChanges(candidate, message.changes);

            const projected = createAutomergePeer({
              schema,
              nodes,
              generation,
              actor: Automerge.getActorId(candidate),
              seed: Automerge.save(candidate),
            });

            nodes = projected.nodes;
            projected.destroy();
          } catch {
            Automerge.free(candidate);

            return reject('invalid');
          }

          Automerge.free(doc);
          doc = candidate;
          const result = { kind: 'accepted', hash: change.hash } as const;
          receipts.set(change.hash, result);

          return result;
        },
        leave() {
          closed = true;
        },
      };
    },
    destroy() {
      Automerge.free(doc);
    },
  };
}
