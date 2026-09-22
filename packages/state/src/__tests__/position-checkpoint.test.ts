import type { AnchorMap } from '@gprose/transform';
import { expect, test } from 'vitest';

import { encodePositionCheckpoint, parsePositionCheckpoint } from '../position-checkpoint.js';

const maps: AnchorMap[] = [
  { kind: 'replace', key: 'a', from: 2, to: 4, inserted: 3 },
  { kind: 'split', key: 'a', at: 5, rightKey: 'b' },
  { kind: 'join', key: 'a', at: 5, rightKey: 'b' },
  { kind: 'insert', keys: ['c', 'd'] },
  {
    kind: 'remove',
    keys: ['b'],
    boundaries: [{ key: 'b', side: 'before', left: { key: 'a', side: 'after' }, right: null }],
    fallbacks: [{ key: 'b', before: { key: 'a', offset: 5 }, after: null }],
  },
];

function fixture() {
  const document = { documentId: 'document', revision: 5, since: 0 };
  const definitions = new Map([[2, maps]]);

  const events = [
    { revision: 2, operations: [{ id: 2, inverse: false }] },
    { revision: 4, operations: [{ id: 2, inverse: true }] },
    { revision: 5, operations: [{ id: 2, inverse: false }] },
  ];

  return { document, definitions, events };
}

test('compact checkpoints round-trip all maps, revision gaps and restore direction through JSON', () => {
  const { document, definitions, events } = fixture();
  const checkpoint = encodePositionCheckpoint(document, definitions, events);
  expect(checkpoint.version).toBe(2);
  expect(checkpoint.keys).toEqual(['a', 'b']);
  expect(checkpoint.events).toEqual([
    [2, [2]],
    [4, [-2]],
    [5, [2]],
  ]);
  expect(parsePositionCheckpoint(JSON.parse(JSON.stringify(checkpoint)))).toEqual({
    version: 1,
    ...document,
    definitions: [{ id: 2, maps }],
    events,
  });
});

test('existing v1 checkpoints load without changing mapping identity or ordering', () => {
  const { document, events } = fixture();
  const checkpoint = { version: 1, ...document, definitions: [{ id: 2, maps }], events };
  expect(parsePositionCheckpoint(JSON.parse(JSON.stringify(checkpoint)))).toEqual(checkpoint);
});

test('snapshots own their nested data in both directions', () => {
  const { document, definitions, events } = fixture();
  const checkpoint = encodePositionCheckpoint(document, definitions, events);
  const before = JSON.stringify(checkpoint);
  const decoded = parsePositionCheckpoint(checkpoint);
  const remove = decoded.definitions[0].maps[4];
  expect(remove).not.toBe(maps[4]);
  const encodedRemove = checkpoint.definitions[0][1][4];

  if (Array.isArray(encodedRemove)) throw new Error('Expected structural map');
  // Caller inputs and returned structural objects must never alias.
  expect(encodedRemove.keys).not.toBe(remove.kind === 'remove' ? remove.keys : undefined);
  checkpoint.keys[0] = 'changed';
  checkpoint.events[0][1][0] = -2;
  expect(JSON.stringify(encodePositionCheckpoint(document, definitions, events))).toBe(before);
  expect(decoded.definitions[0].maps[0]).toEqual(maps[0]);
});

test('numeric encoding preserves safe integers beyond 32-bit offsets and revisions', () => {
  const revision = Number.MAX_SAFE_INTEGER;

  const checkpoint = encodePositionCheckpoint(
    { documentId: 'large', revision, since: revision - 2 },
    new Map([
      [revision - 1, [{ kind: 'replace', key: 'a', from: 2 ** 32, to: 2 ** 32 + 1, inserted: 0 }]],
    ]),
    [{ revision, operations: [{ id: revision - 1, inverse: true }] }],
  );

  const restored = parsePositionCheckpoint(JSON.parse(JSON.stringify(checkpoint)));
  expect(restored.events[0].operations[0]).toEqual({ id: revision - 1, inverse: true });
  expect(restored.definitions[0].maps[0]).toMatchObject({ from: 2 ** 32, to: 2 ** 32 + 1 });
});

test('untrusted checkpoint data rejects invalid references, tags, ranges and numeric encodings', () => {
  const { document, definitions, events } = fixture();
  const checkpoint = encodePositionCheckpoint(document, definitions, events);

  for (const map of [
    [0, 50, 0, 0, 1],
    [1, 0, 1, 50],
    [2, -1, 0, 0],
    [0, 0, 4, 2, 1],
    [0, 0, 0, 0, 1, 2],
    [3, 0, 0, 0],
    [0, 0, 0, 0, Infinity],
  ]) {
    expect(() => parsePositionCheckpoint({ ...checkpoint, definitions: [[2, [map]]] })).toThrow(
      /Invalid|Too (?:big|small)|integer/,
    );
  }

  for (const id of [0, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    expect(() => parsePositionCheckpoint({ ...checkpoint, events: [[2, [id]]] })).toThrow(
      /Invalid|Too (?:big|small)|integer/,
    );
  }

  expect(() => parsePositionCheckpoint({ ...checkpoint, version: 3 })).toThrow(
    /Invalid|Too (?:big|small)|integer/,
  );
});
