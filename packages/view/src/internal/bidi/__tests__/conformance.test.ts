import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { expect, test } from 'vitest';

import { analyzeBidi, bidiLine, type TextDirection } from '../paragraph.js';
import { getBidiCharType, TYPES } from '../properties.js';
import sources from '../unicode-sources.json';

function fixture(name: 'BidiTest.txt' | 'BidiCharacterTest.txt') {
  const bytes = gunzipSync(readFileSync(new URL(`./fixtures/${name}.gz`, import.meta.url)));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sources.sha256[name]);

  return bytes.toString().split('\n');
}

function check(
  text: string,
  direction: TextDirection,
  expectedLevels: string[],
  expectedOrder: string,
  context: string,
  base?: number,
) {
  const analysis = analyzeBidi(text, direction);
  const line = bidiLine(analysis, 0, analysis.points.length);

  if (base !== undefined && analysis.paragraphs[0]?.level !== base)
    throw new Error(`${context}: paragraph direction mismatch`);

  for (let i = 0; i < expectedLevels.length; i++)
    if (expectedLevels[i] !== 'x' && line.levels[i] !== Number(expectedLevels[i]))
      throw new Error(
        `${context}: level ${i}, expected ${expectedLevels.join(' ')}, got ${[...line.levels].join(' ')}`,
      );
  const order = [...line.order].join(' ');

  if (order !== expectedOrder)
    throw new Error(`${context}: order expected ${expectedOrder}, got ${order}`);
}

test('all Unicode 17 BidiCharacterTest cases: levels, paragraph direction and visual order', () => {
  let count = 0;

  for (const raw of fixture('BidiCharacterTest.txt')) {
    const data = raw.split('#')[0].trim();

    if (!data) continue;
    const [points, mode, base, levels, order] = data.split(';').map((field) => field.trim());

    const text = String.fromCodePoint(
      ...points.split(/\s+/).map((point) => Number.parseInt(point, 16)),
    );

    check(
      text,
      mode === '0' ? 'ltr' : mode === '1' ? 'rtl' : 'auto',
      levels.split(/\s+/),
      order,
      data,
      Number(base),
    );
    count++;
  }

  expect(count).toBe(91707);
}, 30000);

const representatives = new Map([
  ['L', 0x61],
  ['R', 0x5d0],
  ['EN', 0x30],
  ['ES', 0x2b],
  ['ET', 0x24],
  ['AN', 0x660],
  ['CS', 0x2c],
  ['B', 0x2029],
  ['S', 0x9],
  ['WS', 0x20],
  ['ON', 0x21],
  ['BN', 0x200b],
  ['NSM', 0x300],
  ['AL', 0x627],
  ['LRO', 0x202d],
  ['RLO', 0x202e],
  ['LRE', 0x202a],
  ['RLE', 0x202b],
  ['PDF', 0x202c],
  ['LRI', 0x2066],
  ['RLI', 0x2067],
  ['FSI', 0x2068],
  ['PDI', 0x2069],
]);

test('all Unicode 17 BidiTest class sequences in every specified paragraph direction', () => {
  for (const [name, value] of Object.entries(TYPES))
    expect(getBidiCharType(representatives.get(name) ?? 0)).toBe(value);

  let levels: string[] = [],
    order = '',
    count = 0;

  for (const raw of fixture('BidiTest.txt')) {
    const data = raw.split('#')[0].trim();

    if (!data) continue;

    if (data.startsWith('@Levels:')) {
      levels = data.slice(8).trim().split(/\s+/);
      continue;
    }

    if (data.startsWith('@Reorder:')) {
      order = data.slice(9).trim();
      continue;
    }

    if (data.startsWith('@')) continue;
    const [classes, flags] = data.split(';');

    const text = String.fromCodePoint(
      ...classes
        .trim()
        .split(/\s+/)
        .map((name) => {
          const point = representatives.get(name);

          if (point === undefined) throw new Error(`Unknown test class ${name}`);

          return point;
        }),
    );

    const mask = Number.parseInt(flags, 16);

    for (const [flag, direction] of [
      [1, 'auto'],
      [2, 'ltr'],
      [4, 'rtl'],
    ] satisfies [number, TextDirection][])
      if (mask & flag) {
        check(text, direction, levels, order, `${data}; ${direction}`);
        count++;
      }
  }

  expect(count).toBe(770241);
}, 30000);
