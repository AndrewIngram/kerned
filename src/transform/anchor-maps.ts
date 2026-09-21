import type { RemovedBoundary } from './boundary-maps';

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
