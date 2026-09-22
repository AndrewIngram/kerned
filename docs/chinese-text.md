# Horizontal Chinese text

The canvas editor supports Han text, Bopomofo and mixed Chinese/Latin/RTL text.
Choose **Journey to the West · 西遊記** in the demo for the complete 100-chapter
novel. Its 2,968 blocks use the existing incremental document loader, viewport
composition and retention policy. The browser-rendered version remains available
at `/samples/journey-to-the-west.html` for comparison.

## Fonts

Font coverage is explicit. The default font configuration remains unchanged;
it does not cover Chinese. Applications opt in with the existing `fonts` option
on `mountEditor` or `EditorContent`. For example:

```ts
import { defaultFonts, type FontConfiguration } from '@gprose/view';

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
```

The demo loads these two fonts only for the Chinese book. They add 33,436,652
uncompressed bytes on its first load. Subsequent sample switches reuse the
bounded asset cache. The font configuration is an application choice, not a
schema dependency. Text using a missing configured font can report missing
glyphs; accepting a script does not promise universal character coverage.

The static regular/bold faces come from the official
[Noto Sans CJK 2.004 release](https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004),
pinned to commit `523d033d6cb47f4a80c58a35753646f5c3608a78`. Source URLs, byte counts
and checksums are in `apps/demo/public/fonts/checksums.json`. `pnpm run setup`
downloads and verifies the assets. `LICENSE-CJK.txt` retains the SIL Open Font
License. The TC faces choose Traditional Chinese glyph forms. Other regional
forms require an appropriate configured font; script detection cannot identify
a document's language from shared Han characters.

## Layout and interaction

Chinese uses the existing script/font itemization, shaping boundary, UAX 14
break opportunities and TypeScript composition. No new runtime dependency or
serialization format was added. Style ranges and inline atoms reuse one
paragraph upload; width changes reuse retained shaping.

The composer honours legal breaks around opening and closing punctuation,
including when a prohibited pair is wider than the line. It overflows the pair
instead of splitting it. Tests follow the basic restrictions described in
[W3C's Chinese layout draft](https://www.w3.org/TR/clreq/#prohibition_rules_for_line_start_end).
This is not a claim of full Chinese typography conformance.

Logical positions remain UTF-16 offsets at grapheme boundaries. `wordRanges`
provides shared word ranges for logical navigation and the visual caret index.
It preserves Han dictionary segments that Firefox reports as non-word-like.
Word edges spanning a soft wrap compare rows before horizontal coordinates.

Browser tests cover every book paragraph's glyph coverage, mixed-direction
text, supplementary Han, bold text, punctuation at widths from 24 to 640 pixels,
caret/hit round trips and width-only shaping reuse. Mounted tests cover
composition-event replacement, one-step undo, selection and formatting at
280 and 700 pixels. Full-page tests cover progressive loading, offscreen edits,
viewport retention, and loading the Chinese fonts only once across sample
switches in Chromium, Firefox and WebKit.

## Limits

- Horizontal Chinese only. Japanese kana, Korean, vertical writing, ruby and
  regional language-specific shaping selection are not enabled.
- No punctuation compression, hanging punctuation, Chinese justification or
  automatic Chinese/Latin spacing. Breaks use the current UAX 14 implementation,
  without configurable locale-specific strictness.
- No Chinese italic synthesis. Requesting italic falls back to an available face.
- Composition events are covered; native OS candidate windows, mobile keyboards
  and real IME device behaviour still need manual validation.
- The complete source is fetched and parsed before model chunks are appended.
  Streaming model/layout work is incremental; network parsing is not streaming.
