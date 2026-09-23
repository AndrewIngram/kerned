import type { AnchorMap } from '@kerned/transform';

export type MappingPoint = { key: string; offset: number };

type Effect = { kind: 'text'; from: number; to: number; delta: number } | { kind: 'structural' };

function summarize(maps: readonly AnchorMap[]) {
  const effects = new Map<string, Effect>();

  for (const map of maps) {
    switch (map.kind) {
      case 'replace': {
        const old = effects.get(map.key);

        if (old?.kind === 'structural') break;
        const delta = old?.delta ?? 0;
        // Points before every edit never move. Points after every edit have
        // already accumulated the preceding deltas when reaching the next edit.
        effects.set(map.key, {
          kind: 'text',
          from: Math.min(old?.from ?? Infinity, map.from),
          to: Math.max(old?.to ?? -Infinity, map.to - delta),
          delta: delta + map.inserted - (map.to - map.from),
        });
        break;
      }

      case 'split':
      case 'join':
        effects.set(map.key, { kind: 'structural' });
        effects.set(map.rightKey, { kind: 'structural' });
        break;
      case 'remove':
        for (const key of map.keys) effects.set(key, { kind: 'structural' });
        break;
      case 'insert':
        break;
      default: {
        const exhaustive: never = map;
        throw new Error(`Unknown mapping: ${String(exhaustive)}`);
      }
    }
  }

  return effects;
}

export function projectOutside(
  effects: Pick<ReadonlyMap<string, Effect>, 'get'>,
  point: MappingPoint | null,
  bias: -1 | 1,
): MappingPoint | null | false {
  if (!point) return null;
  const effect = effects.get(point.key);

  if (!effect) return point;

  if (effect.kind === 'structural') return false;

  if (point.offset < effect.from || (point.offset === effect.from && bias === -1)) return point;

  if (point.offset > effect.to || (point.offset === effect.to && bias === 1))
    return effect.delta === 0 ? point : { key: point.key, offset: point.offset + effect.delta };

  // Interior points need exact replay, even for zero net delta.
  return false;
}

/** Inclusive boundary shortcuts must not hide full replacement of a range. */
export function mayCoverRange(
  effects: Pick<ReadonlyMap<string, Effect>, 'get'>,
  start: MappingPoint | null,
  end: MappingPoint | null,
): boolean {
  if (!start || !end || start.key !== end.key) return false;
  const effect = effects.get(start.key);

  return effect?.kind === 'text' && effect.from <= start.offset && effect.to >= end.offset;
}

/** Query index over document mappings, independent of the number of external ranges. */
export function createMappingIndex(maps: readonly AnchorMap[]) {
  let chunks:
    | { maps: readonly AnchorMap[]; effects: Pick<ReadonlyMap<string, Effect>, 'get'> }[]
    | undefined;

  return {
    effects: summarize(maps),
    weight: maps.reduce(
      (sum, map) =>
        sum + (map.kind === 'remove' || map.kind === 'insert' ? map.keys.length + 1 : 1),
      0,
    ),
    chunks() {
      if (!chunks) {
        chunks = [];

        for (let i = 0; i < maps.length; i += 64) {
          const part = maps.slice(i, i + 64);
          chunks.push({ maps: part, effects: summarize(part) });
        }
      }

      return chunks;
    },
  };
}

/** Shared suffix summaries for different capture revisions in forward-only history. */
export function createRevisionMappingIndex(
  events: Iterable<{ revision: number; maps: readonly AnchorMap[] }>,
) {
  const histories = new Map<string, { revision: number; effect: Effect }[]>();

  for (const { revision, maps } of events)
    for (const map of maps) {
      const keys =
        map.kind === 'replace'
          ? [map.key]
          : map.kind === 'split' || map.kind === 'join'
            ? [map.key, map.rightKey]
            : map.kind === 'remove'
              ? map.keys
              : [];

      for (const key of keys) {
        let history = histories.get(key);

        if (!history) {
          history = [];
          histories.set(key, history);
        }

        history.push({
          revision,
          effect:
            map.kind === 'replace'
              ? {
                  kind: 'text',
                  from: map.from,
                  to: map.to,
                  delta: map.inserted - (map.to - map.from),
                }
              : { kind: 'structural' },
        });
      }
    }

  for (const history of histories.values())
    for (let i = history.length - 2; i >= 0; i--) {
      const current = history[i].effect,
        next = history[i + 1].effect;

      history[i].effect =
        current.kind === 'structural' || next.kind === 'structural'
          ? { kind: 'structural' }
          : {
              kind: 'text',
              from: Math.min(current.from, next.from),
              to: Math.max(current.to, next.to - current.delta),
              delta: current.delta + next.delta,
            };
    }

  return {
    at(revision: number): Pick<ReadonlyMap<string, Effect>, 'get'> {
      return {
        get(key) {
          const history = histories.get(key);

          if (!history) return undefined;

          let low = 0,
            high = history.length;

          while (low < high) {
            const mid = (low + high) >>> 1;

            if (history[mid].revision <= revision) low = mid + 1;
            else high = mid;
          }

          return history[low]?.effect;
        },
      };
    },
  };
}

export function combineEffects(
  left: Effect | undefined,
  right: Effect | undefined,
): Effect | undefined {
  if (!left) return right;

  if (!right) return left;

  if (left.kind === 'structural' || right.kind === 'structural') return { kind: 'structural' };

  return {
    kind: 'text',
    from: Math.min(left.from, right.from),
    to: Math.max(left.to, right.to - left.delta),
    delta: left.delta + right.delta,
  };
}
