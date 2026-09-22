import * as Automerge from '@automerge/automerge';

import { bodySchema, type Body, type Update } from './wire.js';

type PartitionUpdate = { update: Update; heads: Automerge.Heads };

type Partition = { doc: Automerge.Doc<{ body: Body }>; signature: string };

/** Only the authority owns this store. Each native document contains one block's
 * payload and never a sibling's payload or canonical document history. */
export function createPartitions() {
  const partitions = new Map<string, Partition>();

  return {
    update(key: string, body: Body, heads: Automerge.Heads | undefined): PartitionUpdate {
      const signature = JSON.stringify(body);
      let partition = partitions.get(key);

      if (!partition) {
        partition = { doc: Automerge.from({ body }), signature };
        partitions.set(key, partition);
      } else if (partition.signature !== signature) {
        partition.doc = Automerge.change(partition.doc, (draft) => {
          draft.body = body;
        });
        partition.signature = signature;
      }

      return {
        update:
          heads === undefined
            ? {
                kind: 'automerge',
                key,
                mode: 'snapshot',
                bytes: [Array.from(Automerge.save(partition.doc))],
              }
            : {
                kind: 'automerge',
                key,
                mode: 'changes',
                bytes: Automerge.getChangesSince(partition.doc, heads).map((change) =>
                  Array.from(change),
                ),
              },
        heads: Automerge.getHeads(partition.doc),
      };
    },
    clear() {
      for (const partition of partitions.values()) Automerge.free(partition.doc);
      partitions.clear();
    },
  };
}

/** Native receive state is optional: JSON clients do not import a WASM backend. */
export function createReceivedPartitions() {
  const docs = new Map<string, Automerge.Doc<{ body: Body }>>();

  return {
    receive(update: Extract<Update, { kind: 'automerge' }>) {
      if (update.mode === 'snapshot') {
        const previous = docs.get(update.key);

        if (previous) Automerge.free(previous);
        docs.set(update.key, Automerge.load<{ body: Body }>(new Uint8Array(update.bytes[0])));
      } else {
        const doc = docs.get(update.key);

        if (!doc) throw new Error('Missing partition');

        const [next] = Automerge.applyChanges(
          doc,
          update.bytes.map((value) => new Uint8Array(value)),
        );

        docs.set(update.key, next);
      }

      const doc = docs.get(update.key);

      if (!doc) throw new Error('Missing partition');

      return bodySchema.parse(doc.body);
    },
    retain(keys: ReadonlySet<string>) {
      for (const [key, doc] of docs)
        if (!keys.has(key)) {
          Automerge.free(doc);
          docs.delete(key);
        }
    },
    clear() {
      for (const doc of docs.values()) Automerge.free(doc);
      docs.clear();
    },
  };
}
