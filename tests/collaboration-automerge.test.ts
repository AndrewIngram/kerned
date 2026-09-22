import * as Automerge from '@automerge/automerge';
import { expect, test } from 'vitest';

import {
  createAutomergePeer,
  createAutomergeSeed,
  parseCursorSelection,
} from './experiments/collaboration/automerge.js';
import { schema, replacementCases, type Node } from './experiments/collaboration/fixtures.js';

function fixture(value = 'abcdef') {
  const nodes = [{ kind: 'note', id: 1, key: 'one', value }] satisfies Node[];
  const seed = createAutomergeSeed(schema, nodes);
  const options = { schema, nodes, generation: 'document/epoch-1', seed };
  const alice = createAutomergePeer({ ...options, actor: 'aa', nodes: [{ ...nodes[0], id: 11 }] });
  const bob = createAutomergePeer({ ...options, actor: 'bb', nodes: [{ ...nodes[0], id: 22 }] });

  return {
    alice,
    bob,
    options,
    destroy() {
      alice.destroy();
      bob.destroy();
    },
  };
}

const insert = (at: number, text: string) => ({ key: 'one', from: at, to: at, text, expected: '' });

const selection = (anchor: number, head = anchor, association: -1 | 1 = 1) => ({
  anchor: { key: 'one', offset: anchor, association },
  head: { key: 'one', offset: head, association },
});

test('Automerge converges with native ordering rather than authority acceptance ordering', () => {
  const f = fixture('ab');

  const a = f.alice.edit(insert(1, 'A')),
    b = f.bob.edit(insert(1, 'B'));

  f.alice.receive(b);
  f.alice.receive(b);
  f.bob.receive(a);
  f.bob.receive(a);
  expect(schema.text(f.alice.nodes[0])).toBe('aBAb');
  expect(schema.text(f.bob.nodes[0])).toBe('aBAb');
  expect(f.alice.nodes[0].id).toBe(11);
  expect(f.bob.nodes[0].id).toBe(22);
  f.destroy();
});

test('the same 225 concurrent replacement cases converge without explicit overlap rejection', () => {
  let count = 0;

  for (const edits of replacementCases()) {
    const f = fixture('abcd');

    const a = f.alice.edit(edits.first),
      b = f.bob.edit(edits.second);

    f.alice.receive(b);
    f.bob.receive(a);
    expect(schema.text(f.alice.nodes[0])).toBe(schema.text(f.bob.nodes[0]));
    expect(schema.text(f.alice.nodes[0])).toContain('X');
    expect(schema.text(f.alice.nodes[0])).toContain('Y');
    f.destroy();
    count++;
  }

  expect(count).toBe(225);
});

test('multiple local edits and their cursor can precede dependency delivery', () => {
  const f = fixture('ab');
  const first = f.alice.edit(insert(1, 'X'));
  const second = f.alice.edit(insert(2, 'Y'));

  const reference = parseCursorSelection(
    JSON.parse(JSON.stringify(f.alice.capture(selection(3, 1)))),
  );

  const before = f.alice.save();
  f.alice.capture(selection(0));
  expect(f.alice.save()).toEqual(before);
  expect(f.bob.resolve(reference)).toEqual({ status: 'unavailable', reason: 'dependencies' });
  f.bob.receive(second);
  expect(schema.text(f.bob.nodes[0])).toBe('ab');
  expect(f.bob.resolve(reference)).toEqual({ status: 'unavailable', reason: 'dependencies' });
  f.bob.receive(first);
  f.bob.receive(second);
  expect(schema.text(f.bob.nodes[0])).toBe('aXYb');
  expect(f.bob.resolve(reference)).toEqual({ status: 'resolved', selection: selection(3, 1) });
  f.destroy();
});

test('native deletion bias is not the editor insertion-boundary association', () => {
  const f = fixture('ab');
  const backward = f.alice.capture(selection(1, 1, -1));
  const forward = f.alice.capture(selection(1));
  f.alice.receive(f.bob.edit(insert(1, 'X')));
  // Both native cursors follow the existing b. Our -1 association should stay at 1.
  expect(f.alice.resolve(backward)).toEqual({ status: 'resolved', selection: selection(2, 2, -1) });
  expect(f.alice.resolve(forward)).toEqual({ status: 'resolved', selection: selection(2) });
  f.destroy();
});

test('native deleted cursors fall back rather than reporting our deleted-range result', () => {
  const f = fixture();
  const captured = f.bob.capture(selection(2));
  f.bob.receive(f.alice.edit({ key: 'one', from: 1, to: 4, text: '', expected: 'bcd' }));
  expect(f.bob.resolve(captured)).toEqual({ status: 'resolved', selection: selection(1) });
  f.destroy();
});

test('serialized cursors survive binary save/load and interior insertions without registering ranges', () => {
  const f = fixture();

  const reference = parseCursorSelection(
    JSON.parse(JSON.stringify(f.alice.capture(selection(1, 5)))),
  );

  f.alice.receive(f.bob.edit(insert(3, 'XYZ')));
  const reopened = createAutomergePeer({ ...f.options, actor: 'cc', seed: f.alice.save() });
  expect(reopened.resolve(reference)).toEqual({ status: 'resolved', selection: selection(1, 8) });
  reopened.destroy();
  f.destroy();
});

test('Unicode input uses UTF-16 offsets and display cursors snap after cluster changes', () => {
  const f = fixture('A😀B');
  expect(() => f.alice.edit(insert(2, '!'))).toThrow('Edit precondition failed');
  f.bob.receive(f.alice.edit(insert(3, '!')));
  expect(schema.text(f.bob.nodes[0])).toBe('A😀!B');
  f.destroy();
  const flags = fixture('🇦X🇧');
  const cursor = flags.bob.capture(selection(2));
  const a = flags.alice.edit({ key: 'one', from: 2, to: 3, text: '', expected: 'X' });
  const b = flags.bob.edit(insert(2, '!'));
  flags.alice.receive(b);
  flags.bob.receive(a);
  expect(schema.text(flags.alice.nodes[0])).toBe(schema.text(flags.bob.nodes[0]));
  expect(schema.text(flags.alice.nodes[0])).toContain('!');
  expect(flags.bob.resolve(cursor).status).toBe('resolved');
  flags.destroy();
});

test('combining mark concurrency converges and normalized presence stays on a grapheme boundary', () => {
  const f = fixture('ab');
  const reference = f.alice.capture(selection(1, 1, -1));
  const a = f.alice.edit(insert(1, '\u0301'));
  const b = f.bob.edit({ key: 'one', from: 0, to: 1, text: 'X', expected: 'a' });
  f.alice.receive(b);
  f.bob.receive(a);
  expect(schema.text(f.alice.nodes[0])).toBe(schema.text(f.bob.nodes[0]));
  expect(f.alice.resolve(reference)).toEqual({
    status: 'resolved',
    selection: selection(2, 2, -1),
  });
  f.destroy();
});

test('cross-block native references resolve in a nested Arabic/Chinese document', () => {
  const nodes: Node[] = [
    {
      kind: 'group',
      id: 1,
      key: 'group',
      children: [
        { kind: 'note', id: 2, key: 'arabic', value: 'مرحبا' },
        { kind: 'note', id: 3, key: 'chinese', value: '你好' },
      ],
    },
  ];

  const options = { schema, nodes, generation: 'mixed', seed: createAutomergeSeed(schema, nodes) };

  const a = createAutomergePeer({ ...options, actor: 'aa' }),
    b = createAutomergePeer({ ...options, actor: 'bb' });

  const captured = a.capture({
    anchor: { key: 'chinese', offset: 2, association: 1 },
    head: { key: 'arabic', offset: 0, association: -1 },
  });

  a.receive(b.edit({ key: 'chinese', from: 1, to: 1, expected: '', text: '世界' }));
  expect(a.resolve(captured)).toEqual({
    status: 'resolved',
    selection: {
      anchor: { key: 'chinese', offset: 4, association: 1 },
      head: { key: 'arabic', offset: 0, association: -1 },
    },
  });
  a.destroy();
  b.destroy();
});

test('raw CRDT changes are not a node permission boundary and dropped changes retain dependencies', () => {
  let seed = Automerge.from({ allowed: 'A', protected: 'PRIVATE SENTINEL' }, { actor: '00' });
  let actor = Automerge.clone(seed, { actor: 'aa' });
  const before = actor;
  actor = Automerge.change(actor, (draft) => Automerge.splice(draft, ['protected'], 0, 0, '!'));
  const denied = Automerge.getChanges(before, actor);
  const afterDenied = actor;
  actor = Automerge.change(actor, (draft) => Automerge.splice(draft, ['allowed'], 1, 0, 'B'));
  const later = Automerge.getChanges(afterDenied, actor);
  [seed] = Automerge.applyChanges(seed, later);
  expect(seed.allowed).toBe('A');
  [seed] = Automerge.applyChanges(seed, denied);
  expect(seed.allowed).toBe('AB');
  expect(seed.protected).toBe('!PRIVATE SENTINEL');
  Automerge.free(actor);
  Automerge.free(seed);
});

test('native start and end cursors have special insertion semantics', () => {
  const f = fixture('ab');
  const start = f.alice.capture(selection(0, 0, -1));
  const end = f.alice.capture(selection(2, 2, -1));
  f.alice.receive(f.bob.edit(insert(0, 'X')));
  f.alice.receive(f.bob.edit(insert(3, 'Y')));
  expect(f.alice.resolve(start)).toEqual({ status: 'resolved', selection: selection(1, 1, -1) });
  expect(f.alice.resolve(end)).toEqual({ status: 'resolved', selection: selection(4, 4, -1) });
  f.destroy();
});
