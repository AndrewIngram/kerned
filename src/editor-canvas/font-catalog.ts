import { z } from 'zod';

const family = z.string().trim().min(1);

const weight = z.number().finite().min(1).max(1000);

const style = z.enum(['normal', 'italic']);

const face = z.strictObject({
  family,
  weight,
  style,
  asset: z.templateLiteral(['fonts/', z.string().min(1)]),
});

const selection = z.strictObject({
  family: family.optional(),
  weight: weight.default(400),
  style: style.default('normal'),
});

export type FontSelection = Readonly<z.input<typeof selection>>;

export type FontSource = Readonly<z.infer<typeof face>>;

export type FontConfiguration = Readonly<{
  faces: readonly FontSource[];
  defaultFamily: string;
  emojiFamily: string;
}>;

export const defaultFonts: FontConfiguration = Object.freeze({
  defaultFamily: 'Noto Sans',
  emojiFamily: 'Noto Color Emoji',
  faces: Object.freeze(
    [
      { family: 'Noto Sans', weight: 400, style: 'normal', asset: 'fonts/NotoSans-Regular.ttf' },
      { family: 'Noto Sans', weight: 700, style: 'normal', asset: 'fonts/NotoSans-Bold.ttf' },
      { family: 'Noto Sans', weight: 400, style: 'italic', asset: 'fonts/NotoSans-Italic.ttf' },
      { family: 'Noto Sans', weight: 700, style: 'italic', asset: 'fonts/NotoSans-BoldItalic.ttf' },
      {
        family: 'Noto Color Emoji',
        weight: 400,
        style: 'normal',
        asset: 'fonts/NotoColorEmoji.ttf',
      },
    ].map((value) => Object.freeze(face.parse(value))),
  ),
});

const configuration = z.strictObject({
  faces: z.array(face).min(1).max(256),
  defaultFamily: family,
  emojiFamily: family,
});

/** Validate once, then match semantic faces independently of native registration order. */
export function createFontCatalog(input: FontConfiguration = defaultFonts) {
  const value = configuration.parse(input);
  const faces = Object.freeze(value.faces.map((entry) => Object.freeze(entry)));
  const families = new Map<string, readonly FontSource[]>();

  for (const entry of faces) {
    const key = entry.family.toLowerCase();
    const previous = families.get(key) ?? [];

    if (previous.some((other) => other.weight === entry.weight && other.style === entry.style))
      throw new Error(`Duplicate font face: ${entry.family} ${entry.weight} ${entry.style}`);
    families.set(key, [...previous, entry]);
  }

  function registered(name: string) {
    const result = families.get(name.toLowerCase());

    if (!result) throw new Error(`Font family must be registered: ${name}`);

    return result;
  }

  const fallback = registered(value.defaultFamily);
  registered(value.emojiFamily);
  const cache = new Map<string, FontSource>();

  function select(request: FontSelection = {}) {
    const requested = selection.parse(request);
    const name = (requested.family ?? value.defaultFamily).toLowerCase();
    const key = `${name}/${requested.weight}/${requested.style}`;
    const cached = cache.get(key);

    if (cached) return cached;
    const available = families.get(name) ?? fallback;
    const matching = available.filter((entry) => entry.style === requested.style);
    const candidates = matching.length ? matching : available;

    const chosen = candidates.toSorted(
      (a, b) =>
        weightDistance(a.weight, requested.weight) - weightDistance(b.weight, requested.weight),
    )[0];

    cache.set(key, chosen);

    const oldest = cache.keys().next();

    if (cache.size > 128 && !oldest.done) cache.delete(oldest.value);

    return chosen;
  }

  return {
    faces,
    select,
    emoji: select({ family: value.emojiFamily }),
  };
}

// CSS Fonts weight search order, for static normal/italic faces (no synthesis).
function weightDistance(candidate: number, requested: number) {
  if (requested < 400) return candidate <= requested ? requested - candidate : 1000 + candidate;

  if (requested > 500) return candidate >= requested ? candidate - requested : 2000 - candidate;

  if (candidate >= requested && candidate <= 500) return candidate - requested;

  return candidate < requested ? 1000 - candidate : 2000 + candidate;
}
