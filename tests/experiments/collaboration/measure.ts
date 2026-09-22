import { createAuthority } from './authority.js';
import { createAutomergePeer, createAutomergeSeed } from './automerge.js';
import { createClient } from './client.js';
import { schema, type Node } from './fixtures.js';

/** Whole disposable adapters, including projection and validation. Not a backend microbenchmark. */
export function measureCollaboration(edits: number) {
  const nodes = [{ kind: 'note', id: 1, key: 'one', value: 'x'.repeat(1024) }] satisfies Node[];
  const options = { schema, nodes, generation: 'bench', now: () => 0, presenceLifetime: 1000 };
  const authority = createAuthority(options);
  const connection = authority.connect('alice');
  const alice = createClient({ ...options, session: connection.session });
  const bob = createClient({ ...options, session: authority.connect('bob').session });
  const seed = createAutomergeSeed(schema, nodes);
  const first = createAutomergePeer({ ...options, seed, actor: 'aa' });
  const second = createAutomergePeer({ ...options, seed, actor: 'bb' });
  const bytes = (value: string) => new TextEncoder().encode(value).length;

  try {
    let authorityBytes = 0,
      automergeBytes = 0;

    const start = performance.now();

    for (let i = 0; i < edits; i++) {
      const request = alice.propose({
        key: 'one',
        from: 512,
        to: 513,
        expected: i === 0 ? 'x' : i % 2 ? 'A' : 'B',
        text: i % 2 ? 'B' : 'A',
      });

      const receipt = connection.submit(request);

      if (receipt.kind !== 'accepted') throw new Error(receipt.reason);
      alice.receive(receipt.commit);
      bob.receive(receipt.commit);
      authorityBytes += bytes(JSON.stringify(request)) + 2 * bytes(JSON.stringify(receipt.commit));
    }

    const authorityMs = performance.now() - start;
    const next = performance.now();

    for (let i = 0; i < edits; i++) {
      const changes = first.edit({
        key: 'one',
        from: 512,
        to: 513,
        expected: i === 0 ? 'x' : i % 2 ? 'A' : 'B',
        text: i % 2 ? 'B' : 'A',
      });

      second.receive(changes);
      automergeBytes += changes.changes.reduce((sum, change) => sum + change.byteLength, 0);
    }

    const automergeMs = performance.now() - next;
    const expected = schema.text(authority.nodes[0]);

    if (
      [alice.nodes, bob.nodes, first.nodes, second.nodes].some(
        (value) => schema.text(value[0]) !== expected,
      )
    )
      throw new Error('Divergence');

    return {
      edits,
      authorityMs,
      automergeMs,
      authorityBytes,
      automergeBytes,
      authorityPositionCheckpointBytes: bytes(JSON.stringify(authority.checkpoint)),
      automergeSavedBytes: first.save().byteLength,
    };
  } finally {
    alice.destroy();
    bob.destroy();
    authority.destroy();
    first.destroy();
    second.destroy();
  }
}
