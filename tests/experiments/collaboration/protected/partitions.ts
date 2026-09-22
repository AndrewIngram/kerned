import * as Automerge from '@automerge/automerge';

import type { Body, Update } from './wire.js';

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
