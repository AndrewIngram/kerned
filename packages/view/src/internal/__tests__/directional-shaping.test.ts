import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';
import { z } from 'zod';

import { decodeShaping } from '../owned-shaped.js';

async function createNativeReader(face: string) {
  const assets = new URL('../../../../../apps/demo/public/', import.meta.url);

  const { instance } = await WebAssembly.instantiate(
    readFileSync(new URL('engines/owned.wasm', assets)),
  );

  const exported = instance.exports.memory;

  if (!(exported instanceof WebAssembly.Memory)) throw new Error('Missing shaping memory');
  const memory = exported;

  function call(name: string, ...args: number[]) {
    return z
      .function({ input: z.tuple([]).rest(z.number()), output: z.number() })
      .parse(instance.exports[name])(...args);
  }

  function allocate(bytes: Uint8Array) {
    const ptr = call('allocate', bytes.length);
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);

    return ptr;
  }

  const font = readFileSync(new URL(`fonts/${face}`, assets));
  const id = call('register_font', allocate(font), font.length);

  function readGlyphs(text: string, from: number, to: number, rtl: boolean) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);

    const ptr = call(
      'shape_run',
      id,
      allocate(bytes),
      bytes.length,
      encoder.encode(text.slice(0, from)).length,
      encoder.encode(text.slice(0, to)).length,
      Number(rtl),
      0,
    );

    expect(ptr).not.toBe(0);
    const words = new Uint32Array(memory.buffer, ptr, call('result_words')).slice();

    return { words, floats: new Float32Array(words.buffer), offset: from, font: 0, scale: 1 };
  }

  return readGlyphs;
}

test('real Hebrew shaping emits RTL glyph clusters and decodes logical combining ranges', async () => {
  const readGlyphs = await createNativeReader('NotoSansHebrew-Regular.ttf');
  const text = 'אב\u05b0ג';
  const run = readGlyphs(text, 0, text.length, true);
  expect(run.words[4]).toBe(3);
  const decoded = decodeShaping(text, [run], new Uint32Array([text.length]));
  expect([...decoded.clusterStarts]).toEqual([0, 1, 3]);
  expect([...decoded.clusterEnds]).toEqual([1, 3, 4]);
  expect([...decoded.glyphs.ids[0]]).not.toContain(0);
});

test('Arabic retains joining context when a style boundary splits a word', async () => {
  const readGlyphs = await createNativeReader('NotoSansArabic-Regular.ttf');
  const text = 'ببب';
  const whole = readGlyphs(text, 0, text.length, true);
  const contextual = readGlyphs(text, 1, 2, true);
  const isolated = readGlyphs('ب', 0, 1, true);
  expect(contextual.words[3] & 0xffff).toBe(whole.words[8] & 0xffff);
  expect(contextual.words[3] & 0xffff).not.toBe(isolated.words[3] & 0xffff);
  expect(contextual.words[3] & 0xffff).not.toBe(0);
  expect(whole.words[8] >>> 31).toBe(1);
  expect(contextual.words[4]).toBe(0);
});
