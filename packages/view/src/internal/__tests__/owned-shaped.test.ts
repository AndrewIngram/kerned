import { expect, test } from 'vitest';

import { decodeShaping, type ShapingRun } from '../owned-shaped.js';

function run(entries: [number, number, number][], offset = 0): ShapingRun {
  const words = new Uint32Array(3 + entries.length * 5);
  const floats = new Float32Array(words.buffer);
  words[0] = entries.length;
  words[2] = 1000;
  entries.forEach(([cluster, glyph, advance], index) => {
    words[3 + index * 5] = glyph;
    words[4 + index * 5] = cluster;
    floats[5 + index * 5] = advance;
  });

  return { words, floats, offset, font: 0, scale: 1 };
}

test('RTL shaping becomes logical clusters without reversing marks within a cluster', () => {
  const decoded = decodeShaping(
    'אב\u05b0ג',
    [
      run([
        [3, 3, 10],
        [1, 2, 9],
        [1, 4, 0],
        [0, 1, 8],
      ]),
    ],
    new Uint32Array([4]),
  );

  expect([...decoded.clusterStarts]).toEqual([0, 1, 3]);
  expect([...decoded.clusterEnds]).toEqual([1, 3, 4]);
  expect([...decoded.widths]).toEqual([8, 9, 10]);
  expect([...decoded.glyphs.ids[0]]).toEqual([1, 2, 4, 3]);
  expect([...decoded.glyphs.starts]).toEqual([0, 1, 3, 4]);
  expect([...decoded.stops]).toEqual([1, 3, 4]);
  expect([...decoded.breaks]).toEqual([0, 0, 1]);
});

test('mixed directional runs retain absolute UTF-16 offsets and ligature ranges', () => {
  const decoded = decodeShaping(
    'a\u{1e900}\u{1e901}fi',
    [
      run([[0, 1, 8]]),
      run(
        [
          [2, 3, 10],
          [0, 2, 10],
        ],
        1,
      ),
      run([[0, 4, 12]], 5),
    ],
    new Uint32Array([7]),
  );

  expect([...decoded.clusterStarts]).toEqual([0, 1, 3, 5]);
  expect([...decoded.clusterEnds]).toEqual([1, 3, 5, 7]);
  expect([...decoded.stops]).toEqual([1, 3, 5, 6, 7]);
  expect([...decoded.stopStarts]).toEqual([0, 1, 2, 3, 5]);
});
