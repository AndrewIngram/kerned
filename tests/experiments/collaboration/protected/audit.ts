import * as Automerge from '@automerge/automerge';
import { z } from 'zod';

import { decodeFrame, type Body } from './wire.js';

/** Inspect actual serialized frames AND decompress every native historical state.
 * Searching compressed byte arrays for a sentinel alone would be a false proof. */
export function inspectWire(frames: readonly Uint8Array[]) {
  const docs = new Map<string, Automerge.Doc<{ body: Body }>>();
  const evidence: string[] = [];

  function clear() {
    for (const doc of docs.values()) Automerge.free(doc);
    docs.clear();
  }

  try {
    for (const bytes of frames) {
      const frame = decodeFrame(bytes);
      evidence.push(new TextDecoder().decode(bytes));

      if (frame.base === null) clear();

      for (const update of frame.updates) {
        if (update.kind !== 'automerge') continue;

        if (update.mode === 'snapshot') {
          const previous = docs.get(update.key);

          if (previous) Automerge.free(previous);
          docs.set(update.key, Automerge.load<{ body: Body }>(new Uint8Array(update.bytes[0])));
        } else {
          const previous = docs.get(update.key);

          if (!previous) throw new Error('Missing audit partition');

          const [next] = Automerge.applyChanges(
            previous,
            update.bytes.map((value) => new Uint8Array(value)),
          );

          docs.set(update.key, next);
        }

        const doc = docs.get(update.key);

        if (!doc) throw new Error('Missing audit partition');

        for (const change of Automerge.getAllChanges(doc)) {
          const decoded = Automerge.decodeChange(change);
          evidence.push(JSON.stringify(decoded));
          evidence.push(
            decoded.ops
              .map((op) => {
                const value = z.string().safeParse(op.value);

                return value.success ? value.data : '';
              })
              .join(''),
          );
          evidence.push(JSON.stringify(Automerge.view(doc, [decoded.hash])));
        }
      }
    }

    return evidence.join('\n');
  } finally {
    clear();
  }
}
