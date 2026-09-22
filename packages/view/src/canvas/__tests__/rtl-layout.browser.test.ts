import { boundaries } from '@gprose/model';
import { TextSelection } from '@gprose/state';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { createTextNavigation } from '../../browser/keyboard-navigation.js';
import { createViewResources } from '../resources.js';

const resources = createViewResources();

beforeAll(async () => {
  await resources.ready;
});

afterAll(() => resources.destroy());

test.each([
  'مرحبًا بالعالم',
  'שָׁלוֹם עולם',
  'English שלום العربية 123 (test)',
  'Ελληνικά Кириллица',
  ',ְ',
])('shapes and maps %s with no missing glyphs', (text) => {
  const owner = resources.read().layout.createLayout();

  try {
    for (const width of [80, 300, 640]) {
      const layout = owner.layout({ id: 1, text, spans: [], size: 24, width });
      expect(layout.missing).toBe(0);
      const stops = boundaries(text);

      for (const index of stops) {
        const caret = layout.geometry(index, index, false).caret;
        expect(caret.every(Number.isFinite)).toBe(true);
        const hit = layout.hit(caret[0], (caret[1] + caret[3]) / 2);
        expect(stops).toContain(hit.index);
        const actual = layout.geometry(hit.index, hit.index, hit.upstream).caret;
        expect(actual[0]).toBeCloseTo(caret[0]);
        expect(actual[1]).toBeCloseTo(caret[1]);
      }

      expect(layout.geometry(0, text.length, false).rects.length).toBeGreaterThan(0);
    }
  } finally {
    owner.destroy();
  }
});

test('RTL uses right alignment, visual arrows and explicit direction for an empty paragraph', () => {
  const owner = resources.read().layout.createLayout();

  try {
    const input = { id: 1, text: 'אבג', spans: [], size: 24, width: 300 };
    const layout = owner.layout(input);
    expect(layout.geometry(0, 0, false).caret[0]).toBeCloseTo(300);
    expect(layout.move(0, false, 'left').index).toBe(1);
    expect(layout.move(1, false, 'right').index).toBe(0);
    expect(layout.directionAt?.(0, false)).toBe('rtl');
    expect(
      owner.layout({ ...input, text: '', direction: 'rtl' }).geometry(0, 0, false).caret[0],
    ).toBe(300);
    expect(
      owner.layout({ ...input, text: '', direction: 'ltr' }).geometry(0, 0, false).caret[0],
    ).toBe(0);
  } finally {
    owner.destroy();
  }
});

test('Arabic joining survives formatting and overlong words do not break unsafely', () => {
  const engine = resources.read().layout;
  const owner = engine.createLayout();

  try {
    const text = 'ب'.repeat(20);

    const input = {
      id: 2,
      text,
      spans: [{ start: 2, end: 10, bold: true, italic: false }],
      size: 24,
      width: 20,
    };

    const small = owner.layout(input);
    expect(small.lines).toHaveLength(1);
    expect(small.lines[0].width).toBeGreaterThan(input.width);
    expect(small.geometry(0, 0, false).caret[0]).toBeCloseTo(input.width);
    expect(small.missing).toBe(0);
    const calls = engine.stats.glyphCalls;
    const wide = owner.layout({ ...input, width: 640 });
    expect(engine.stats.glyphCalls).toBe(calls);
    expect(wide.lines[0].width).toBeCloseTo(small.lines[0].width);

    const words = owner.layout({
      ...input,
      text: 'مرحبا بالعالم '.repeat(15),
      spans: [],
      width: 180,
    });

    expect(words.lines.length).toBeGreaterThan(5);
    expect(
      words.lines
        .slice(0, -1)
        .every((line) => /\s/.test('مرحبا بالعالم '.repeat(15)[line.end - 1])),
    ).toBe(true);
  } finally {
    owner.destroy();
  }
});

test('inline atoms occupy their visual RTL interval and keep labels independent', () => {
  const owner = resources.read().layout.createLayout();

  try {
    const text = 'אב \ufffc גד';

    const layout = owner.layoutInline({
      id: 3,
      text,
      spans: [],
      size: 24,
      width: 300,
      atoms: [{ id: 'badge', index: 3, label: 'Hello', width: 50, ascent: 25, descent: 5 }],
    });

    const box = layout.inlineBoxes[0];
    const selection = layout.geometry(3, 4, false).rects;
    expect(selection).toHaveLength(1);
    expect(box.x).toBeCloseTo(selection[0][0]);
    expect(box.x + box.width).toBeCloseTo(selection[0][2]);
    expect(layout.missing).toBe(0);
  } finally {
    owner.destroy();
  }
});

test('shift and word arrows follow RTL while crossing blocks follows document order', () => {
  const owner = resources.read().layout.createLayout();

  try {
    const text = 'אבג דהו';
    const layout = owner.layout({ id: 1, text, spans: [], size: 24, width: 300 });
    const navigation = createTextNavigation();

    const move = (offset: number, key: string, shiftKey = false, altKey = false) =>
      navigation.move({
        event: { key, shiftKey, altKey, ctrlKey: false, metaKey: false },
        selection: new TextSelection({ id: 1, offset }),
        blocks: [
          { id: 1, text, top: 0, height: 40 },
          { id: 2, text: 'next', top: 50, height: 40 },
        ],
        layout: () => layout,
        viewportHeight: 500,
        platform: 'mac',
      });

    expect(move(0, 'ArrowLeft', true)?.head.offset).toBe(1);
    expect(move(0, 'ArrowLeft', true)?.anchor.offset).toBe(0);
    expect(move(0, 'ArrowLeft', false, true)?.head.offset).toBe(3);
    expect(move(3, 'ArrowRight', false, true)?.head.offset).toBe(0);
    expect(move(text.length, 'ArrowLeft')?.head).toEqual({ id: 2, offset: 0 });
    const newline = owner.layout({ id: 4, text: 'אבג\nnext', spans: [], size: 24, width: 300 });
    expect(newline.move(3, false, 'left').index).toBe(4);
    expect(newline.move(4, false, 'left').index).toBe(3);
  } finally {
    owner.destroy();
  }
});

test.each(['hayy-ibn-yaqzan', 'tashlikh'])('lays out every paragraph of %s', async (id) => {
  const html = await (await fetch(`/samples/${id}.html`)).text();
  const document = new DOMParser().parseFromString(html, 'text/html');
  const owner = resources.read().layout.createLayout();
  const missing: string[] = [];

  try {
    for (const [index, element] of [...document.querySelectorAll('#book > *')].entries()) {
      const text = element.textContent.replace(/\s+/g, ' ').trim();
      const layout = owner.layout({ id: index, text, spans: [], size: 20, width: 320 });

      if (layout.missing) missing.push(`${index}: ${text.slice(0, 100)}`);
      expect(layout.height).toBeGreaterThan(0);
      owner.release(index);
    }

    expect(missing).toEqual([]);
  } finally {
    owner.destroy();
  }
});
