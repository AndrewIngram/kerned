import { expect, test } from 'vitest';

import {
  parseCommit,
  parsePresence,
  parsePresenceSnapshot,
  parseProposal,
  type Commit,
} from '../packages/collaboration-lab/src/protocol.js';
import { createAuthority, type Receipt } from './experiments/collaboration/authority.js';
import { createClient } from './experiments/collaboration/client.js';
import { schema, replacementCases, type Node } from './experiments/collaboration/fixtures.js';

function fixture(value = 'abcdef') {
  let time = 0;
  const denied = new Set<string>();
  const hidden = new Set<string>();

  const shared = {
    schema,
    nodes: [{ kind: 'note', id: 1, key: 'one', value }] satisfies Node[],
    generation: 'document/epoch-1',
    now: () => time,
    presenceLifetime: 1000,
  };

  const authority = createAuthority({
    ...shared,
    canEdit: (_principal, node) => !denied.has(node.key),
    canSeePresence: (_principal, node) => !hidden.has(node.key),
  });

  const a = authority.connect('alice'),
    b = authority.connect('bob');

  // Runtime handles intentionally differ from the authority and each other.
  const alice = createClient({
    ...shared,
    nodes: [{ ...shared.nodes[0], id: 11 }],
    session: a.session,
  });

  const bob = createClient({
    ...shared,
    nodes: [{ ...shared.nodes[0], id: 22 }],
    session: b.session,
  });

  return {
    authority,
    a,
    b,
    alice,
    bob,
    denied,
    hidden,
    tick: (amount: number) => {
      time += amount;
    },
    destroy() {
      alice.destroy();
      bob.destroy();
      authority.destroy();
    },
  };
}

const insert = (at: number, text: string) => ({ key: 'one', from: at, to: at, text, expected: '' });

const selection = (anchor: number, head = anchor) => ({
  anchor: { key: 'one', offset: anchor, association: 1 as const },
  head: { key: 'one', offset: head, association: 1 as const },
});

function accepted(receipt: Receipt): Commit {
  if (receipt.kind !== 'accepted') throw new Error(`Rejected: ${receipt.reason}`);

  return parseCommit(JSON.parse(JSON.stringify(receipt.commit)));
}

function converge(f: ReturnType<typeof fixture>, ...commits: Commit[]) {
  for (const commit of commits) {
    f.alice.receive(commit);
    f.bob.receive(commit);
  }

  expect(f.alice.nodes.map((node) => schema.text(node))).toEqual(
    f.authority.nodes.map((node) => schema.text(node)),
  );
  expect(f.bob.nodes.map((node) => schema.text(node))).toEqual(
    f.authority.nodes.map((node) => schema.text(node)),
  );
}

function sendPresence(
  client: ReturnType<typeof fixture>['alice'],
  connection: ReturnType<typeof fixture>['a'],
) {
  const packet = client.presence();

  if (!packet) throw new Error('Selection not acknowledged');
  expect(connection.presence(parsePresence(JSON.parse(JSON.stringify(packet))))).toBe(true);
}

test('two optimistic clients converge on same-position inserts with duplicate and reordered delivery', () => {
  const f = fixture('ab');

  const first = f.alice.propose(insert(1, 'A')),
    second = f.bob.propose(insert(1, 'B'));

  expect(schema.text(f.alice.nodes[0])).toBe('aAb');
  expect(schema.text(f.bob.nodes[0])).toBe('aBb');
  const a = accepted(f.a.submit(parseProposal(JSON.parse(JSON.stringify(first)))));
  const b = accepted(f.b.submit(second));
  expect(f.a.submit(first)).toEqual({ kind: 'accepted', commit: a });
  expect(() => f.a.submit({ ...first, edit: insert(0, 'forged retry') })).toThrow(
    'Operation identity reused',
  );
  converge(f, b, b, a, a);
  expect(schema.text(f.authority.nodes[0])).toBe('aABb');
  expect(f.authority.version).toBe(2);
  expect(f.alice.waiting || f.bob.waiting).toBe(false);
  expect(f.alice.history).toEqual({ undo: 0, redo: 0 });
  f.destroy();
});

test('all small replacement pairs either converge or return an explicit overlap conflict', () => {
  const reasons = new Set<string>();

  let conflicts = 0,
    acceptedPairs = 0;

  for (const edits of replacementCases()) {
    const f = fixture('abcd');
    const first = f.alice.propose(edits.first);
    const second = f.bob.propose(edits.second);
    const ca = accepted(f.a.submit(first));
    const outcome = f.b.submit(second);

    if (outcome.kind === 'accepted') {
      converge(f, accepted(outcome), ca);
      acceptedPairs++;
    } else {
      reasons.add(outcome.reason);
      f.bob.reject(outcome);
      converge(f, ca);
      conflicts++;
    }

    f.destroy();
  }

  expect([...reasons]).toEqual(['overlap']);
  expect(conflicts).toBe(90);
  expect(acceptedPairs).toBe(135);
});

test('presence waits for acknowledgement, retains backward direction and defers future versions', () => {
  const f = fixture();
  f.bob.select(selection(5, 1));

  const a = f.alice.propose(insert(0, 'X')),
    b = f.bob.propose(insert(0, 'B'));

  expect(f.bob.presence()).toBeNull();

  const ca = accepted(f.a.submit(a)),
    cb = accepted(f.b.submit(b));

  f.bob.receive(ca);
  expect(f.bob.presence()).toBeNull();
  f.bob.receive(cb);
  sendPresence(f.bob, f.b);
  f.alice.receivePresence(parsePresenceSnapshot(JSON.parse(JSON.stringify(f.a.readPresence()))));
  expect(f.alice.remoteSelections()).toEqual([]);
  f.alice.receive(cb);
  expect(f.alice.remoteSelections()).toEqual([]);
  f.alice.receive(ca);
  expect(f.alice.remoteSelections()).toEqual([
    { session: f.b.session, selection: selection(7, 3) },
  ]);
  expect(f.bob.selection).toEqual(selection(7, 3));
  f.destroy();
});

test('remote presence projects through a receiver pending edit without changing selection or history', () => {
  const f = fixture();
  f.bob.select(selection(1, 5));
  sendPresence(f.bob, f.b);
  f.alice.select(selection(3));
  f.alice.propose(insert(0, 'hello'));

  const checkpoint = f.alice.checkpoint,
    local = f.alice.selection,
    history = f.alice.history;

  f.alice.receivePresence(f.a.readPresence());
  expect(f.alice.remoteSelections()).toEqual([
    { session: f.b.session, selection: selection(6, 10) },
  ]);
  expect(f.alice.checkpoint).toEqual(checkpoint);
  expect(f.alice.selection).toEqual(local);
  expect(f.alice.history).toEqual(history);
  f.destroy();
});

test('snapshots clear departures and revocation, ignore reordering and expire without sender clock trust', () => {
  const f = fixture();
  f.bob.select(selection(2));
  sendPresence(f.bob, f.b);
  const old = f.a.readPresence();
  expect(f.alice.receivePresence(old)).toBe(true);
  f.hidden.add('one');
  const redacted = f.a.readPresence();
  expect(JSON.stringify(redacted)).not.toContain('one');
  f.alice.receivePresence(redacted);
  expect(f.alice.remoteSelections()).toEqual([]);
  expect(f.alice.receivePresence(old)).toBe(false);
  f.hidden.clear();
  f.alice.receivePresence(f.a.readPresence());
  expect(f.alice.remoteSelections()).toHaveLength(1);
  f.tick(1000);
  expect(f.alice.remoteSelections()).toEqual([]);
  expect(f.a.readPresence().peers).toEqual([]);
  sendPresence(f.bob, f.b);
  f.alice.receivePresence(f.a.readPresence());
  f.b.leave();
  f.alice.receivePresence(f.a.readPresence());
  expect(f.alice.remoteSelections()).toEqual([]);
  expect(f.b.presence({ ...old.peers[0], sequence: 500 })).toBe(false);
  const reconnected = f.authority.connect('bob');
  expect(reconnected.session).not.toBe(f.b.session);
  f.destroy();
});

test('authority validates original coordinates, rechecks access and retains rejected request identity', () => {
  const f = fixture('A😀B');

  const bad = {
    generation: 'document/epoch-1',
    version: 0,
    sequence: 1,
    edit: insert(2, 'broken'),
  };

  expect(f.a.submit(bad)).toMatchObject({ kind: 'rejected', reason: 'precondition' });
  const request = f.bob.propose(insert(3, '!'));
  f.denied.add('one');
  const result = f.b.submit(request);
  expect(result).toMatchObject({ kind: 'rejected', reason: 'permission' });

  if (result.kind !== 'rejected') throw new Error('Expected denial');
  f.bob.reject(result);
  f.denied.clear();
  expect(f.b.submit(request)).toEqual(result);
  expect(schema.text(f.authority.nodes[0])).toBe('A😀B');
  expect(schema.text(f.bob.nodes[0])).toBe('A😀B');
  f.destroy();
});

test('nested and cross-block selections include ancestor permissions and intermediate nodes', () => {
  const nodes: Node[] = [
    {
      kind: 'group',
      id: 1,
      key: 'group',
      children: [
        { kind: 'note', id: 2, key: 'arabic', value: 'مرحبا' },
        { kind: 'note', id: 3, key: 'secret', value: 'PRIVATE SENTINEL' },
        { kind: 'note', id: 4, key: 'chinese', value: '你好' },
      ],
    },
  ];

  const hidden = new Set<string>();

  const authority = createAuthority({
    schema,
    nodes,
    generation: 'mixed',
    now: () => 0,
    presenceLifetime: 1000,
    canSeePresence: (_reader, node) => !hidden.has(node.key),
  });

  const a = authority.connect('a'),
    b = authority.connect('b');

  b.presence({
    generation: 'mixed',
    sequence: 1,
    version: 0,
    selection: {
      anchor: { key: 'chinese', offset: 2, association: 1 },
      head: { key: 'arabic', offset: 0, association: -1 },
    },
  });
  expect(a.readPresence().peers).toHaveLength(1);
  hidden.add('secret');
  expect(a.readPresence().peers).toEqual([]);
  hidden.clear();
  hidden.add('group');
  expect(a.readPresence().peers).toEqual([]);
  expect(JSON.stringify(a.readPresence())).not.toContain('PRIVATE SENTINEL');
  authority.destroy();
});

test('deleted selection endpoints are hidden rather than invented elsewhere', () => {
  const f = fixture();
  f.bob.select(selection(2));
  sendPresence(f.bob, f.b);
  f.alice.receivePresence(f.a.readPresence());

  const commit = accepted(
    f.a.submit(f.alice.propose({ key: 'one', from: 1, to: 4, text: '', expected: 'bcd' })),
  );

  converge(f, commit);
  expect(f.alice.remoteSelections()).toEqual([]);
  expect(f.a.readPresence().peers[0].selection).toBeNull();
  f.destroy();
});

test('generation mismatches and excessive gaps do not mutate confirmed state', () => {
  const f = fixture();
  const before = f.alice.checkpoint;
  const commit = accepted(f.b.submit(f.bob.propose(insert(0, 'x'))));
  expect(() => f.alice.receive({ ...commit, generation: 'other' })).toThrow(
    'Wrong document generation',
  );
  expect(() => f.alice.receive({ ...commit, version: 65 })).toThrow('Resynchronization required');
  expect(f.alice.checkpoint).toEqual(before);
  expect(
    f.alice.receivePresence({
      generation: 'other',
      recipient: f.a.session,
      sequence: 1,
      peers: [],
    }),
  ).toBe(false);
  converge(f, commit);
  expect(() => f.alice.receive({ ...commit, edit: insert(0, 'different') })).toThrow(
    'Conflicting authority version',
  );
  f.destroy();
});

test('stale presence cannot renew expiry and packet mutation cannot rewrite retained state', () => {
  const f = fixture();
  f.bob.select(selection(2));
  const packet = f.bob.presence();

  if (!packet) throw new Error('Expected presence');
  expect(f.b.presence(packet)).toBe(true);
  f.tick(900);
  expect(f.b.presence(packet)).toBe(false);

  if (!packet.selection) throw new Error('Expected selection');
  packet.selection.anchor.offset = 99;
  expect(f.a.readPresence().peers[0].selection).toEqual(selection(2));
  f.tick(100);
  expect(f.a.readPresence().peers).toEqual([]);
  f.destroy();
});

test('diverged client content fails before an authority operation changes its document', () => {
  const f = fixture();

  const commit = accepted(
    f.a.submit(f.alice.propose({ key: 'one', from: 0, to: 1, text: 'Z', expected: 'a' })),
  );

  const before = f.bob.checkpoint;
  expect(() => f.bob.receive({ ...commit, edit: { ...commit.edit, expected: 'wrong' } })).toThrow(
    'Edit precondition failed',
  );
  expect(f.bob.checkpoint).toEqual(before);
  expect(schema.text(f.bob.nodes[0])).toBe('abcdef');
  f.destroy();
});

test('rebasing across a new grapheme hides an invalid pending edit and keeps presence on a boundary', () => {
  const f = fixture('🇦X🇧');
  f.bob.select(selection(2));
  sendPresence(f.bob, f.b);
  const a = f.alice.propose({ key: 'one', from: 2, to: 3, text: '', expected: 'X' });
  const b = f.bob.propose(insert(2, '!'));
  const commit = accepted(f.a.submit(a));
  f.bob.receive(commit);
  expect(schema.text(f.bob.nodes[0])).toBe('🇦🇧');
  const rejection = f.b.submit(b);
  expect(rejection).toMatchObject({ kind: 'rejected', reason: 'precondition' });
  expect(f.a.readPresence().peers[0].selection).toEqual(selection(4));

  if (rejection.kind !== 'rejected') throw new Error('Expected grapheme conflict');
  f.bob.reject(rejection);
  f.destroy();
});

test('combining-mark edits snap backward-associated presence without breaking other peers', () => {
  const f = fixture('ab');

  const caret = {
    anchor: { key: 'one', offset: 1, association: -1 as const },
    head: { key: 'one', offset: 1, association: -1 as const },
  };

  const third = f.authority.connect('carol');
  third.presence({
    generation: 'document/epoch-1',
    version: 0,
    sequence: 1,
    selection: selection(2),
  });
  f.bob.select(caret);
  sendPresence(f.bob, f.b);
  f.alice.select(caret);
  const request = f.alice.propose(insert(1, '\u0301'));
  expect(f.alice.selection).toEqual({
    anchor: { ...caret.anchor, offset: 0 },
    head: { ...caret.head, offset: 0 },
  });
  const pending = f.bob.propose({ key: 'one', from: 0, to: 1, text: 'X', expected: 'a' });
  const commit = accepted(f.a.submit(request));
  f.bob.receive(commit);
  expect(schema.text(f.bob.nodes[0])).toBe('áb');
  expect(f.bob.selection).toBeNull();
  expect(f.bob.waiting).toBe(true);
  const snapshot = f.a.readPresence();
  expect(snapshot.peers.map((peer) => peer.selection)).toEqual([
    { anchor: { ...caret.anchor, offset: 0 }, head: { ...caret.head, offset: 0 } },
    selection(3),
  ]);
  f.alice.receivePresence(snapshot);
  f.alice.receive(commit);
  expect(f.alice.remoteSelections().map((peer) => peer.selection)).toEqual(
    snapshot.peers.map((peer) => peer.selection),
  );
  const rejected = f.b.submit(pending);
  expect(rejected).toMatchObject({ kind: 'rejected', reason: 'precondition' });
  f.destroy();
});
