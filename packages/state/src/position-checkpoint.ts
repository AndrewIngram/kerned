import type { AnchorMap } from '@gprose/transform';
import { z } from 'zod';

const positionInteger = z.number().int().nonnegative();

const identity = z.string().min(1);

const point = z.object({ key: identity, offset: positionInteger });

const edge = z.object({ key: identity, side: z.enum(['before', 'after']) });

const structuralMapping = z.union([
  z.object({ kind: z.literal('insert'), keys: z.array(identity) }),
  z.object({
    kind: z.literal('remove'),
    keys: z.array(identity),
    boundaries: z.array(edge.extend({ left: edge.nullable(), right: edge.nullable() })).optional(),
    fallbacks: z
      .array(z.object({ key: identity, before: point.nullable(), after: point.nullable() }))
      .optional(),
  }),
]);

const mapping = z.union([
  z
    .object({
      kind: z.literal('replace'),
      key: identity,
      from: positionInteger,
      to: positionInteger,
      inserted: positionInteger,
    })
    .refine((data) => data.to >= data.from, 'Invalid replacement mapping'),
  z.object({ kind: z.literal('split'), key: identity, at: positionInteger, rightKey: identity }),
  z.object({ kind: z.literal('join'), key: identity, at: positionInteger, rightKey: identity }),
  structuralMapping,
]);

const checkpointSchema = z.object({
  version: z.literal(1),
  documentId: identity,
  revision: positionInteger,
  since: positionInteger,
  definitions: z.array(z.object({ id: positionInteger, maps: z.array(mapping) })),
  events: z.array(
    z.object({
      revision: positionInteger,
      operations: z.array(z.object({ id: positionInteger, inverse: z.boolean() })),
    }),
  ),
});

export type DecodedPositionCheckpoint = Omit<z.infer<typeof checkpointSchema>, 'definitions'> & {
  definitions: { id: number; maps: readonly AnchorMap[] }[];
};

// Only the persisted representation uses tuples. The resolver and transforms
// continue to use named mapping fields.
const compactMapping = z.union([
  z
    .tuple([z.literal(0), positionInteger, positionInteger, positionInteger, positionInteger])
    .refine((map) => map[3] >= map[2], 'Invalid replacement mapping'),
  z.tuple([z.literal(1), positionInteger, positionInteger, positionInteger]),
  z.tuple([z.literal(2), positionInteger, positionInteger, positionInteger]),
  structuralMapping,
]);

const compactCheckpoint = z.object({
  version: z.literal(2),
  documentId: identity,
  revision: positionInteger,
  since: positionInteger,
  keys: z.array(identity),
  definitions: z.array(z.tuple([positionInteger, z.array(compactMapping)])),
  events: z.array(
    z.tuple([
      positionInteger,
      z.array(
        z
          .number()
          .int()
          .refine((id) => id !== 0, 'Invalid mapping operation'),
      ),
    ]),
  ),
});

type CompactMapping =
  | Extract<z.infer<typeof compactMapping>, readonly unknown[]>
  | Extract<AnchorMap, { kind: 'insert' | 'remove' }>;

export type PositionCheckpoint = Omit<z.infer<typeof compactCheckpoint>, 'definitions'> & {
  definitions: [number, CompactMapping[]][];
};

const persistedCheckpoint = z.union([checkpointSchema, compactCheckpoint]);

function decodeCheckpoint(value: z.infer<typeof persistedCheckpoint>): DecodedPositionCheckpoint {
  if (value.version === 1) return value;
  const keys = value.keys;

  function key(index: number): string {
    const valueKey = keys[index];

    if (valueKey === undefined) throw new Error('Invalid checkpoint key index');

    return valueKey;
  }

  function decode(map: CompactMapping): AnchorMap {
    if (!Array.isArray(map)) return map;

    switch (map[0]) {
      case 0:
        return { kind: 'replace', key: key(map[1]), from: map[2], to: map[3], inserted: map[4] };
      case 1:
        return { kind: 'split', key: key(map[1]), at: map[2], rightKey: key(map[3]) };
      case 2:
        return { kind: 'join', key: key(map[1]), at: map[2], rightKey: key(map[3]) };
      default:
        return map satisfies never;
    }
  }

  return {
    version: 1,
    documentId: value.documentId,
    revision: value.revision,
    since: value.since,
    definitions: value.definitions.map(([id, maps]) => ({ id, maps: maps.map(decode) })),
    events: value.events.map(([revision, operations]) => ({
      revision,
      operations: operations.map((id) => ({ id: Math.abs(id), inverse: id < 0 })),
    })),
  };
}

const normalizedCheckpoint = persistedCheckpoint.transform(decodeCheckpoint);

export const parsePositionCheckpoint = normalizedCheckpoint.parse.bind(normalizedCheckpoint);

export function encodePositionCheckpoint(
  document: { documentId: string; revision: number; since: number },
  definitions: ReadonlyMap<number, readonly AnchorMap[]>,
  events: readonly { revision: number; operations: readonly { id: number; inverse: boolean }[] }[],
): PositionCheckpoint {
  const keys: string[] = [];
  const ids = new Map<string, number>();

  function intern(key: string): number {
    const existing = ids.get(key);

    if (existing !== undefined) return existing;
    const id = keys.length;
    keys.push(key);
    ids.set(key, id);

    return id;
  }

  function encode(map: AnchorMap): CompactMapping {
    switch (map.kind) {
      case 'replace':
        return [0, intern(map.key), map.from, map.to, map.inserted];
      case 'split':
        return [1, intern(map.key), map.at, intern(map.rightKey)];
      case 'join':
        return [2, intern(map.key), map.at, intern(map.rightKey)];
      case 'insert':
      case 'remove':
        return structuredClone(map);
      default:
        return map satisfies never;
    }
  }

  return {
    version: 2,
    ...document,
    keys,
    definitions: [...definitions].map(([id, maps]) => [id, maps.map(encode)]),
    events: events.map(({ revision, operations }) => [
      revision,
      operations.map((op) => (op.inverse ? -op.id : op.id)),
    ]),
  };
}
