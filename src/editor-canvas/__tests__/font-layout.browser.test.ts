import { expect, test } from 'vitest';

import type { LaidOut } from '../../engines';
import { defaultFonts } from '../font-catalog';
import { createViewResources } from '../resources';

type Resources = ReturnType<ReturnType<typeof createViewResources>['read']>;

function pixels(resources: Resources, layout: LaidOut) {
  const { kit } = resources;
  const surface = kit.MakeSurface(300, 120);

  if (!surface) throw new Error('Expected test surface');

  try {
    surface.getCanvas().clear(kit.WHITE);
    layout.draw(surface.getCanvas(), 4, 4);

    const bytes = surface.getCanvas().readPixels(0, 0, {
      width: 300,
      height: 120,
      colorType: kit.ColorType.RGBA_8888,
      alphaType: kit.AlphaType.Unpremul,
      colorSpace: kit.ColorSpace.SRGB,
    });

    if (!bytes) throw new Error('Expected rendered pixels');

    return bytes;
  } finally {
    surface.dispose();
  }
}

test('reordering font registration preserves styled text, emoji, inline geometry and pixels', async ({
  onTestFinished,
}) => {
  const ordinary = createViewResources();

  const reordered = createViewResources({
    fonts: { ...defaultFonts, faces: defaultFonts.faces.toReversed() },
  });

  onTestFinished(() => {
    ordinary.destroy();
    reordered.destroy();
  });
  await Promise.all([ordinary.ready, reordered.ready]);
  const a = ordinary.read();
  const b = reordered.read();
  const first = a.layout.createLayout();
  const second = b.layout.createLayout();

  const input = {
    id: 1,
    text: 'ABCD 😀',
    size: 22,
    width: 260,
    spans: [
      { start: 0, end: 2, bold: true, italic: false },
      { start: 1, end: 4, bold: false, italic: true },
    ],
  };

  const regular = first.layout(input);
  const reversed = second.layout(input);
  expect(reversed.lines).toEqual(regular.lines);
  expect(reversed.geometry(1, 7, false)).toEqual(regular.geometry(1, 7, false));
  const actual = pixels(b, reversed);
  const expected = pixels(a, regular);

  const differences = [...actual].flatMap((value, index) =>
    value === expected[index]
      ? []
      : [
          {
            x: Math.floor(index / 4) % 300,
            y: Math.floor(index / 1200),
            channel: index % 4,
            expected: expected[index],
            actual: value,
          },
        ],
  );

  expect(differences).toEqual([]);

  const inlineInput = {
    ...input,
    text: input.text + ' \ufffc end',
    atoms: [{ id: 'atom', index: 8, label: 'Token', width: 40, ascent: 20, descent: 6 }],
  };

  const inline = first.layoutInline(inlineInput);
  const reversedInline = second.layoutInline(inlineInput);
  expect(reversedInline.lines).toEqual(inline.lines);
  expect(reversedInline.inlineBoxes).toEqual(inline.inlineBoxes);
  expect(pixels(b, reversedInline)).toEqual(pixels(a, inline));
});

test('semantic family, weight and style changes invalidate retained shaping at the same node identity', async ({
  onTestFinished,
}) => {
  const owner = createViewResources({
    fonts: {
      ...defaultFonts,
      faces: [...defaultFonts.faces, { ...defaultFonts.faces[1], family: 'Display', weight: 400 }],
    },
  });

  onTestFinished(() => owner.destroy());
  await owner.ready;
  const resources = owner.read();
  const engine = resources.layout;
  const layout = engine.createLayout();
  const input = { id: 1, text: 'Different widths and faces', spans: [], width: 260, size: 22 };
  const regular = layout.layout(input);
  const before = engine.stats.glyphCalls;
  const display = layout.layout({ ...input, font: { family: 'Display' } });
  expect(engine.stats.glyphCalls).toBeGreaterThan(before);
  const bold = layout.layout({ ...input, id: 2, font: { weight: 700 } });
  expect(display.lines).toEqual(bold.lines);
  expect(pixels(resources, display)).toEqual(pixels(resources, bold));
  expect(pixels(resources, display)).not.toEqual(pixels(resources, regular));
  const after = engine.stats.glyphCalls;
  layout.layout({ ...input, font: { family: 'Display' }, width: 220 });
  expect(engine.stats.glyphCalls).toBe(after);
  const italic = layout.layout({ ...input, font: { style: 'italic' } });
  expect(engine.stats.glyphCalls).toBeGreaterThan(after);
  expect(pixels(resources, italic)).not.toEqual(pixels(resources, regular));
  const fallback = layout.layout({ ...input, font: { family: 'Unavailable' } });
  expect(pixels(resources, fallback)).toEqual(pixels(resources, regular));
});
