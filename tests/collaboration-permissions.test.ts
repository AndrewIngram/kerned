import * as Automerge from '@automerge/automerge';
import { indexTree } from '@gprose/model';
import { expect, test } from 'vitest';

import { createAuthority } from './experiments/collaboration/authority.js';
import { createAutomergeAuthority } from './experiments/collaboration/automerge-authority.js';
import {
  recoverAutomergeEdits,
  type PendingTextEdit,
} from './experiments/collaboration/automerge-recovery.js';
import { createAutomergePeer, createAutomergeSeed } from './experiments/collaboration/automerge.js';
import { createClient } from './experiments/collaboration/client.js';
import { schema, type Node } from './experiments/collaboration/fixtures.js';
import type { Edit } from './experiments/collaboration/protocol.js';

function fixture() {
  const nodes: Node[] = [
    {
      kind: 'group',
      id: 1,
      key: 'restricted',
      children: [{ kind: 'note', id: 2, key: 'inside', value: 'private' }],
    },
    { kind: 'note', id: 3, key: 'open', value: 'hello' },
  ];

  const denied = new Set<string>();

  const options = {
    schema,
    nodes,
    generation: 'permissions',
    seed: createAutomergeSeed(schema, nodes),
  };

  const canEdit = (_principal: string, node: Node) => !denied.has(node.key);
  const authority = createAutomergeAuthority({ ...options, canEdit });
  const alice = createAutomergePeer({ ...options, actor: 'aa' });
  const connection = authority.connect('alice', 'aa');
  const pending: PendingTextEdit[] = [];

  function edit(value: Edit) {
    const node = indexTree(schema, alice.nodes).byKey.get(value.key)?.node;
    const before = node && schema.text(node);

    if (before === undefined || before === null) throw new Error('Missing text');
    const message = alice.edit(value);
    pending.push({ sequence: pending.length + 1, edit: value, before });

    return message;
  }

  return {
    nodes,
    options,
    denied,
    canEdit,
    authority,
    alice,
    connection,
    pending,
    edit,
    destroy() {
      alice.destroy();
      authority.destroy();
    },
  };
}

const insert = (key: string, at: number, text: string): Edit => ({
  key,
  from: at,
  to: at,
  text,
  expected: '',
});

const caret = (key: string, offset: number) => ({
  anchor: { key, offset, association: 1 as const },
  head: { key, offset, association: 1 as const },
});

const text = (nodes: readonly Node[], key: string) => {
  const entry = indexTree(schema, nodes).byKey.get(key);

  if (!entry) throw new Error('Missing node');

  return schema.text(entry.node);
};

test('authority rejection leaves canonical state unchanged and the client can submit a new allowed edit', () => {
  const f = fixture();
  const options = { ...f.options, now: () => 0, presenceLifetime: 1000 };
  const authority = createAuthority({ ...options, canEdit: f.canEdit });
  const connection = authority.connect('alice');
  const alice = createClient({ ...options, session: connection.session });
  const proposal = alice.propose(insert('inside', 0, '!'));
  f.denied.add('restricted');
  const checkpoint = authority.checkpoint;
  const rejected = connection.submit(proposal);
  expect(rejected).toEqual({ kind: 'rejected', reason: 'permission', sequence: 1 });

  if (rejected.kind !== 'rejected') throw new Error('Expected rejection');
  alice.reject(rejected);
  expect(authority.version).toBe(0);
  expect(authority.checkpoint).toEqual(checkpoint);
  expect(text(alice.nodes, 'inside')).toBe('private');
  expect(alice.presence()?.selection).toBeNull();
  f.denied.clear();
  expect(connection.submit(proposal)).toEqual(rejected);
  const accepted = connection.submit(alice.propose(insert('open', 5, '!')));

  if (accepted.kind !== 'accepted') throw new Error('Expected acceptance');
  alice.receive(accepted.commit);
  expect(text(alice.nodes, 'open')).toBe('hello!');
  alice.destroy();
  authority.destroy();
  f.destroy();
});

test('Automerge denies ancestor-protected edits atomically and records rejection across a later grant', () => {
  const f = fixture();
  const message = f.edit(insert('inside', 0, '!'));
  f.denied.add('restricted');
  const before = f.authority.save();
  expect(f.connection.submit(message)).toEqual({ kind: 'rejected', reason: 'permission' });
  expect(f.authority.save()).toEqual(before);
  f.denied.clear();
  expect(f.connection.submit(message)).toEqual({ kind: 'rejected', reason: 'permission' });
  expect(text(f.authority.nodes, 'inside')).toBe('private');
  f.destroy();
});

test('recovery reauthors independent edits and preserves only references from accepted history', () => {
  const f = fixture();
  const acceptedReference = f.alice.capture(caret('open', 1));
  const deniedChange = f.edit(insert('inside', 0, '!'));
  const rejectedReference = f.alice.capture(caret('inside', 0));
  const later = f.edit(insert('open', 5, '!'));
  const replayedReference = f.alice.capture(caret('open', 5));
  f.denied.add('restricted');
  expect(f.connection.submit(deniedChange).kind).toBe('rejected');
  expect(f.connection.submit(later)).toEqual({ kind: 'deferred', reason: 'dependencies' });

  const recovery = recoverAutomergeEdits({
    ...f.options,
    base: f.options.seed,
    seed: f.authority.save(),
    actor: 'cc',
    pending: f.pending,
    denied: new Set([1]),
  });

  expect(recovery.outcomes.map(({ sequence, kind }) => ({ sequence, kind }))).toEqual([
    { sequence: 1, kind: 'discarded' },
    { sequence: 2, kind: 'replayed' },
  ]);
  const resumed = f.authority.connect('alice', 'cc');

  for (const outcome of recovery.outcomes.filter((value) => value.kind === 'replayed')) {
    const result = resumed.submit(outcome.message);

    if (result.kind !== 'accepted') throw new Error('Replay rejected');
    expect(resumed.submit(outcome.message)).toEqual(result);
  }

  expect(text(f.authority.nodes, 'inside')).toBe('private');
  expect(text(f.authority.nodes, 'open')).toBe('hello!');
  expect(recovery.peer.resolve(acceptedReference)).toEqual({
    status: 'resolved',
    selection: caret('open', 1),
  });
  expect(recovery.peer.resolve(rejectedReference)).toEqual({
    status: 'unavailable',
    reason: 'dependencies',
  });
  expect(recovery.peer.resolve(replayedReference)).toEqual({
    status: 'unavailable',
    reason: 'dependencies',
  });
  expect(f.connection.submit(later)).toEqual({ kind: 'deferred', reason: 'dependencies' });
  recovery.peer.destroy();
  f.destroy();
});

test('recovery refuses dependent edits and changed text even when an expected substring still matches', () => {
  const f = fixture();
  f.edit(insert('inside', 0, '!'));
  f.edit(insert('inside', 1, '?'));
  f.edit({ key: 'open', from: 1, to: 2, expected: 'e', text: 'E' });
  f.edit(insert('open', 2, '!'));
  const remote = createAutomergePeer({ ...f.options, actor: 'bb' });
  const message = remote.edit(insert('open', 5, '?'));
  expect(f.authority.connect('bob', 'bb').submit(message).kind).toBe('accepted');

  const recovery = recoverAutomergeEdits({
    ...f.options,
    base: f.options.seed,
    seed: f.authority.save(),
    actor: 'cc',
    pending: f.pending,
    denied: new Set([1]),
  });

  expect(recovery.outcomes).toEqual([
    { sequence: 1, kind: 'discarded', reason: 'denied' },
    { sequence: 2, kind: 'discarded', reason: 'dependency' },
    { sequence: 3, kind: 'discarded', reason: 'changed-base' },
    { sequence: 4, kind: 'discarded', reason: 'dependency' },
  ]);
  expect(text(recovery.peer.nodes, 'open')).toBe('hello?');
  remote.destroy();
  recovery.peer.destroy();
  f.destroy();
});

test('replayed changes face current permissions and cannot restore a revoked edit', () => {
  const f = fixture();
  f.edit(insert('open', 5, '!'));

  const recovery = recoverAutomergeEdits({
    ...f.options,
    base: f.options.seed,
    actor: 'cc',
    pending: f.pending,
    denied: new Set(),
  });

  f.denied.add('open');
  const resumed = f.authority.connect('alice', 'cc');

  const outcomes = recovery.outcomes.map((outcome) =>
    outcome.kind === 'replayed' ? resumed.submit(outcome.message) : outcome,
  );

  expect(outcomes).toEqual([{ kind: 'rejected', reason: 'permission' }]);
  expect(text(f.authority.nodes, 'open')).toBe('hello');
  recovery.peer.destroy();
  f.destroy();
});

test('admission inspects every touched object, including forbidden edits cancelled within the change', () => {
  const f = fixture();
  let doc = Automerge.load<{ texts: Record<string, string> }>(f.options.seed, { actor: 'aa' });
  const before = doc;
  doc = Automerge.change(doc, (draft) => {
    Automerge.splice(draft, ['texts', 'inside'], 0, 0, '!');
    Automerge.splice(draft, ['texts', 'inside'], 0, 1, '');
    Automerge.splice(draft, ['texts', 'open'], 0, 0, '?');
  });
  f.denied.add('restricted');
  const message = { generation: f.options.generation, changes: Automerge.getChanges(before, doc) };
  expect(f.connection.submit(message)).toEqual({ kind: 'rejected', reason: 'permission' });
  expect(text(f.authority.nodes, 'open')).toBe('hello');
  Automerge.free(doc);
  f.destroy();
});

test('admission binds actor identity, rejects structural writes, and does not buffer unadmitted changes', () => {
  const f = fixture();
  const first = f.edit(insert('open', 5, '!'));
  const second = f.edit(insert('open', 6, '?'));
  expect(f.connection.submit(second)).toEqual({ kind: 'deferred', reason: 'dependencies' });
  expect(f.authority.connect('bob', 'bb').submit(first)).toEqual({
    kind: 'rejected',
    reason: 'actor',
  });
  expect(f.connection.submit(first).kind).toBe('accepted');
  expect(text(f.authority.nodes, 'open')).toBe('hello!');
  expect(f.connection.submit(second).kind).toBe('accepted');

  let structural = Automerge.load<{ texts: Record<string, string> }>(f.authority.save(), {
    actor: 'cc',
  });

  const before = structural;
  structural = Automerge.change(structural, (draft) => {
    delete draft.texts.inside;
  });
  expect(
    f.authority.connect('carol', 'cc').submit({
      generation: f.options.generation,
      changes: Automerge.getChanges(before, structural),
    }),
  ).toEqual({ kind: 'rejected', reason: 'unsupported' });
  f.connection.leave();
  expect(f.connection.submit(second)).toEqual({ kind: 'rejected', reason: 'closed' });
  expect(() => f.authority.connect('alice', 'aa')).toThrow('Actor already used');
  Automerge.free(structural);
  f.destroy();
});

test('recovery detects replaced character identities even when the accepted text is unchanged', () => {
  const f = fixture();
  f.edit({ key: 'open', from: 0, to: 1, expected: 'h', text: 'H' });
  const remote = createAutomergePeer({ ...f.options, actor: 'bb' });
  const message = remote.edit({ key: 'open', from: 0, to: 5, expected: 'hello', text: 'hello' });
  expect(f.authority.connect('bob', 'bb').submit(message).kind).toBe('accepted');

  const recovery = recoverAutomergeEdits({
    ...f.options,
    base: f.options.seed,
    seed: f.authority.save(),
    actor: 'cc',
    pending: f.pending,
    denied: new Set(),
  });

  expect(recovery.outcomes).toEqual([{ sequence: 1, kind: 'discarded', reason: 'changed-base' }]);
  expect(text(recovery.peer.nodes, 'open')).toBe('hello');
  remote.destroy();
  recovery.peer.destroy();
  f.destroy();
});

test('admission rechecks policies against current content and rejects actor sequence reuse', () => {
  const f = fixture();

  const authority = createAutomergeAuthority({
    ...f.options,
    canEdit: (_principal, node) => schema.text(node) !== 'hello!',
  });

  const connection = authority.connect('alice', 'aa');
  const first = f.edit(insert('open', 5, '!'));
  const second = f.edit(insert('open', 6, '?'));
  expect(connection.submit(first).kind).toBe('accepted');
  expect(connection.submit(second)).toEqual({ kind: 'rejected', reason: 'permission' });
  const fork = createAutomergePeer({ ...f.options, actor: 'aa' });
  expect(connection.submit(fork.edit(insert('open', 0, '?')))).toEqual({
    kind: 'rejected',
    reason: 'identity',
  });
  expect(
    connection.submit({ generation: f.options.generation, changes: [new Uint8Array([1, 2, 3])] }),
  ).toEqual({ kind: 'rejected', reason: 'invalid' });
  expect(text(authority.nodes, 'open')).toBe('hello!');
  authority.destroy();
  fork.destroy();
  f.destroy();
});

test('deferred changes recheck permissions when their dependencies arrive after revocation', () => {
  const f = fixture();
  const first = f.edit(insert('inside', 0, '!'));
  const second = f.edit(insert('open', 5, '?'));
  expect(f.connection.submit(second)).toEqual({ kind: 'deferred', reason: 'dependencies' });
  f.denied.add('open');
  expect(f.connection.submit(first).kind).toBe('accepted');
  expect(text(f.authority.nodes, 'inside')).toBe('!private');
  expect(text(f.authority.nodes, 'open')).toBe('hello');
  expect(f.connection.submit(second)).toEqual({ kind: 'rejected', reason: 'permission' });
  expect(text(f.authority.nodes, 'open')).toBe('hello');
  f.destroy();
});
