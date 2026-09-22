import { boundaries } from '@gprose/model';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { defaultFonts, type FontConfiguration } from '../font-catalog.js';
import { createViewResources } from '../resources.js';

const fonts: FontConfiguration = {
  ...defaultFonts,
  fallbackFamilies: [...(defaultFonts.fallbackFamilies ?? []), 'Noto Sans CJK TC'],
  faces: [
    ...defaultFonts.faces,
    {
      family: 'Noto Sans CJK TC',
      weight: 400,
      style: 'normal',
      asset: 'fonts/NotoSansCJKtc-Regular.otf',
    },
    {
      family: 'Noto Sans CJK TC',
      weight: 700,
      style: 'normal',
      asset: 'fonts/NotoSansCJKtc-Bold.otf',
    },
  ],
};

const resources = createViewResources({ fonts });

beforeAll(async () => {
  await resources.ready;
});

afterAll(() => resources.destroy());

test.each([
  '天地玄黃，宇宙洪荒。日月盈昃，辰宿列張。',
  '他說：「你好，世界！」然後出門。',
  '中文 English 123，שלום العربية。',
  'ㄅㄆㄇ，西遊記𠀋。',
])('Chinese fonts and caret geometry cover %s', (text) => {
  const engine = resources.read().layout;
  const owner = engine.createLayout();

  try {
    for (const width of [48, 160, 640]) {
      const layout = owner.layout({
        id: 1,
        text,
        spans: [{ start: 0, end: 2, bold: true, italic: false }],
        size: 24,
        width,
      });

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
    }
  } finally {
    owner.destroy();
  }
});

test('Chinese wrapping respects opening and closing punctuation at narrow widths', () => {
  const owner = resources.read().layout.createLayout();
  const text = '天地玄黃，宇宙洪荒。他說：「你好，世界！」然後出門。（春夏秋冬）';

  try {
    for (const width of [24, 48, 72, 100, 240]) {
      const layout = owner.layout({ id: 2, text, spans: [], size: 24, width });
      expect(layout.lines.length).toBeGreaterThan(1);

      for (const line of layout.lines) {
        expect(text.slice(line.start, line.end)).not.toMatch(/^[，。！？」）]|[「（]$/u);
      }
    }
  } finally {
    owner.destroy();
  }
});

test('every Journey to the West paragraph has glyph coverage and width-only reflow reuses shaping', async () => {
  const response = await fetch('/samples/journey-to-the-west.html');
  const document = new DOMParser().parseFromString(await response.text(), 'text/html');
  const owner = resources.read().layout.createLayout();
  const engine = resources.read().layout;
  const missing: string[] = [];

  try {
    for (const [index, element] of [...document.querySelectorAll('#book > *')].entries()) {
      const text = element.textContent.replace(/\s+/g, ' ').trim();
      const input = { id: index, text, spans: [], size: 20, width: 320 };
      const layout = owner.layout(input);

      if (layout.missing) missing.push(`${index}: ${text.slice(0, 80)}`);
      const calls = engine.stats.glyphCalls;
      owner.layout({ ...input, width: 700 });
      expect(engine.stats.glyphCalls).toBe(calls);
      owner.release(index);
    }

    expect(missing).toEqual([]);
  } finally {
    owner.destroy();
  }
}, 30000);

test('word movement crosses a soft wrap inside a Chinese word', () => {
  const owner = resources.read().layout.createLayout();

  try {
    const layout = owner.layout({
      id: 3,
      text: '天地玄黃，宇宙洪荒。',
      spans: [],
      size: 24,
      width: 72,
    });

    expect(layout.moveWord?.(2, false, 'right', 'mac')?.index).toBe(4);
    expect(layout.moveWord?.(4, true, 'left', 'mac')?.index).toBe(2);
  } finally {
    owner.destroy();
  }
});
