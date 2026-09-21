import type { BoundaryPoint } from '../transform';
import { projectOutside, mayCoverRange } from './mapping-index';

/** Share the text index shortcuts without skipping a range's complete replacement. */
export function projectBoundaryRange(
  effects: Parameters<typeof projectOutside>[0],
  start: BoundaryPoint | null,
  end: BoundaryPoint | null,
  startBias: -1 | 1,
  endBias: -1 | 1,
): { start: BoundaryPoint | null; end: BoundaryPoint | null } | false {
  function project(point: BoundaryPoint | null, bias: -1 | 1) {
    return point && 'side' in point
      ? effects.get(point.key)?.kind === 'structural'
        ? false
        : point
      : projectOutside(effects, point, bias);
  }

  const first = project(start, startBias),
    last = project(end, endBias);

  if (first === false || last === false) return false;

  if (start && end && !('side' in start) && !('side' in end) && mayCoverRange(effects, start, end))
    return false;

  return { start: first, end: last };
}
