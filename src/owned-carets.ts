import type { Geometry, Line, Rect } from './engines';
import type { Direction, Position } from './model';

// A single paragraph-owned buffer. Capacity includes the worst case of one
// soft line per cluster; finish compacts it before publishing the snapshot.
export function createPackedCarets(capacity: number, lineCapacity: number, lines: Line[], lineHeight: number) {
  let buffer = new ArrayBuffer(capacity * 13 + (lineCapacity + 1) * 4);
  let xs = new Float64Array(buffer, 0, capacity);
  let offsets = new Uint32Array(buffer, capacity * 8, capacity);
  let rowStarts = new Uint32Array(buffer, capacity * 12, lineCapacity + 1);
  let affinities = new Uint8Array(buffer, capacity * 12 + (lineCapacity + 1) * 4, capacity);
  let count = 0, rowCount = 0;
  function bound(value: number, first: number, end: number, upper: boolean) {
    while (first < end) {
      const middle = (first + end) >>> 1;
      if (offsets[middle] < value || upper && offsets[middle] === value) first = middle + 1;
      else end = middle;
    }
    return first;
  }
  function locate(index: number, upstream: boolean) {
    const first = bound(index, 0, count, false);
    if (first === count || offsets[first] !== index) return count - 1;
    return upstream ? first : bound(index, first, count, true) - 1;
  }
  function rowOf(ordinal: number) {
    let low = 0, high = rowCount;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (rowStarts[middle] <= ordinal) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  }
  function closest(x: number, line: number) {
    const row = Math.max(0, Math.min(rowCount - 1, line));
    const first = rowStarts[row], end = rowStarts[row + 1];
    if (!Number.isFinite(x)) return first;
    function lower(target: number) {
      let low = first, high = end;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (xs[middle] < target) low = middle + 1;
        else high = middle;
      }
      return low;
    }
    const next = lower(x);
    const candidate = next === end ? end - 1 : next > first && Math.abs(xs[next - 1] - x) <= Math.abs(xs[next] - x) ? next - 1 : next;
    // Equal-distance and equal-x ties match the object path's first-stop rule.
    return lower(xs[candidate]);
  }
  function position(ordinal: number): Position { return { index: offsets[ordinal], upstream: affinities[ordinal] !== 0 }; }
  return {
    storage() {
      const used = count * 13 + (rowCount + 1) * 4;
      return { caretBufferBytes: buffer.byteLength, caretUsedBytes: used, caretUnusedBytes: buffer.byteLength - used, caretCapacity: capacity, caretCount: count, lineCapacity, lineCount: rowCount };
    },
    beginLine() { rowStarts[rowCount++] = count; },
    append(index: number, x: number, upstream: boolean) {
      offsets[count] = index; xs[count] = x; affinities[count] = Number(upstream); count++;
    },
    finish() {
      rowStarts[rowCount] = count;
      if (capacity === count && lineCapacity === rowCount) return;
      const compact = new ArrayBuffer(count * 13 + (rowCount + 1) * 4);
      const nextXs = new Float64Array(compact, 0, count);
      const nextOffsets = new Uint32Array(compact, count * 8, count);
      const nextRows = new Uint32Array(compact, count * 12, rowCount + 1);
      const nextAffinities = new Uint8Array(compact, count * 12 + (rowCount + 1) * 4, count);
      nextXs.set(xs.subarray(0, count));
      nextOffsets.set(offsets.subarray(0, count));
      nextRows.set(rowStarts.subarray(0, rowCount + 1));
      nextAffinities.set(affinities.subarray(0, count));
      buffer = compact; xs = nextXs; offsets = nextOffsets;
      rowStarts = nextRows; affinities = nextAffinities;
      capacity = count; lineCapacity = rowCount;
    },
    hit(x: number, y: number): Position { return position(closest(x, Math.floor(y / lineHeight))); },
    geometry(anchor: number, focus: number, upstream: boolean): Geometry {
      const ordinal = locate(focus, upstream), line = lines[rowOf(ordinal)];
      const rects: Rect[] = [];
      if (anchor !== focus) {
        const low = Math.min(anchor, focus), high = Math.max(anchor, focus);
        for (let row = 0; row < rowCount; row++) {
          if (lines[row].end < low || lines[row].start > high) continue;
          const first = bound(low, rowStarts[row], rowStarts[row + 1], false);
          const end = bound(high, first, rowStarts[row + 1], true);
          if (end - first > 1) rects.push([xs[first], lines[row].top, xs[end - 1], lines[row].bottom]);
        }
      }
      return { caret: [xs[ordinal], line.top, xs[ordinal] + 1, line.bottom], rects };
    },
    move(index: number, upstream: boolean, direction: Direction): Position {
      const ordinal = locate(index, upstream), row = rowOf(ordinal);
      if (direction === 'up' || direction === 'down') return position(closest(xs[ordinal], row + (direction === 'up' ? -1 : 1)));
      if (direction === 'home' || direction === 'end') return position(closest(direction === 'home' ? 0 : lines[row].width, row));
      return position(Math.max(0, Math.min(count - 1, ordinal + (direction === 'left' ? -1 : 1))));
    },
  };
}
