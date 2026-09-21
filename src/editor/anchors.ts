import { z } from 'zod';

import type { RemovedBoundary } from './relative-boundaries';
import type { NodeIdentity, Schema } from './schema';
import { bindParser } from './schema-codec';
import type { EditorState } from './transactions';
import { indexTree } from './tree';

/** Persist this value alongside the document's ID, revision and mapping journal. */
export type Anchor = {
  version: 1;
  documentId: string;
  revision: number;
  blockKey: string;
  offset: number;
  bias: -1 | 1;
  deleted: boolean;
};

export type AnchorMap =
  | { kind: 'replace'; key: string; from: number; to: number; inserted: number }
  | { kind: 'split'; key: string; at: number; rightKey: string }
  | { kind: 'join'; key: string; rightKey: string; at: number }
  | { kind: 'insert'; keys: readonly string[] }
  | {
      kind: 'remove';
      keys: readonly string[];
      boundaries?: readonly RemovedBoundary[];
      fallbacks?: readonly {
        key: string;
        before: { key: string; offset: number } | null;
        after: { key: string; offset: number } | null;
      }[];
    };

export type RevisionMap = { from: number; to: number; maps: readonly AnchorMap[] };

export type AnchorResolution =
  | { status: 'resolved' | 'deleted'; anchor: Anchor }
  | {
      status: 'unavailable';
      reason: 'document-mismatch' | 'future-revision' | 'history-unavailable' | 'invalid-offset';
    };

export const parseAnchor = bindParser(
  z.object({
    version: z.literal(1),
    documentId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    blockKey: z.string().min(1),
    offset: z.number().int().nonnegative(),
    bias: z.union([z.literal(-1), z.literal(1)]),
    deleted: z.boolean(),
  }),
);

export function createAnchor<N extends NodeIdentity>(
  schema: Schema<N>,
  state: EditorState<N>,
  documentId: string,
  id: number,
  offset: number,
  bias: -1 | 1,
): Anchor {
  const node = indexTree(schema, state.nodes).byId.get(id)?.node;
  const text = node ? schema.text(node) : null;

  if (
    !documentId ||
    !node ||
    text === null ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > text.length
  )
    throw new Error('Invalid anchor target');

  return {
    version: 1,
    documentId,
    revision: state.revision,
    blockKey: node.key,
    offset,
    bias,
    deleted: false,
  };
}

export function invertAnchorMap(map: AnchorMap): AnchorMap {
  switch (map.kind) {
    case 'insert':
      return { ...map, kind: 'remove' };
    case 'remove':
      return { ...map, kind: 'insert' };
    case 'replace':
      return { ...map, to: map.from + map.inserted, inserted: map.to - map.from };
    case 'split':
      return { ...map, kind: 'join' };
    case 'join':
      return { ...map, kind: 'split' };
    default: {
      const exhaustive: never = map;
      throw new Error(String(exhaustive));
    }
  }
}

export function resolveAnchor<N extends NodeIdentity>(
  schema: Schema<N>,
  anchor: Anchor,
  documentId: string,
  state: EditorState<N>,
  journal: readonly RevisionMap[],
): AnchorResolution {
  if (anchor.documentId !== documentId)
    return { status: 'unavailable', reason: 'document-mismatch' };

  if (anchor.revision > state.revision) return { status: 'unavailable', reason: 'future-revision' };
  let current = { ...anchor };

  for (const revision of journal) {
    if (revision.to <= current.revision) continue;

    if (revision.from !== current.revision || revision.to !== revision.from + 1) break;

    for (const map of revision.maps) {
      if (map.kind === 'insert') continue;

      if (map.kind === 'remove') {
        if (map.keys.includes(current.blockKey)) current.deleted = true;
        continue;
      }

      if (map.kind === 'join') {
        if (current.blockKey === map.rightKey) {
          current.blockKey = map.key;
          current.offset += map.at;
        }
      } else if (current.blockKey === map.key) {
        if (map.kind === 'split') {
          if (current.offset > map.at || (current.offset === map.at && current.bias === 1)) {
            current.blockKey = map.rightKey;
            current.offset -= map.at;
          }
        } else {
          const { offset, bias } = current;

          const deleted =
            map.to > map.from &&
            ((offset > map.from && offset < map.to) ||
              (offset === map.from && bias === 1) ||
              (offset === map.to && bias === -1));

          const next =
            offset < map.from
              ? offset
              : offset > map.to
                ? offset + map.inserted - (map.to - map.from)
                : map.from + (bias === 1 ? map.inserted : 0);

          current.offset = next;
          current.deleted ||= deleted;
        }
      }
    }

    current.revision = revision.to;

    if (current.revision === state.revision) break;
  }

  if (current.revision !== state.revision)
    return { status: 'unavailable', reason: 'history-unavailable' };
  const node = indexTree(schema, state.nodes).byKey.get(current.blockKey)?.node;

  if (!node) return { status: 'deleted', anchor: { ...current, deleted: true } };
  const text = schema.text(node);

  if (text === null || current.offset > text.length)
    return { status: 'unavailable', reason: 'invalid-offset' };

  return { status: current.deleted ? 'deleted' : 'resolved', anchor: current };
}
