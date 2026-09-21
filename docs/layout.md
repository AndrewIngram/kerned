# Editor layout pipeline

`editor.html` uses the layout engine in `src/owned-layout.ts` with packed shaping.
CanvasKit draws positioned glyphs; HarfRust shapes text through
`native-owned/src/lib.rs`. TypeScript owns paragraph wrapping, caret positions,
selection geometry, and block placement.

The bridge registers regular, bold, italic, bold-italic, and emoji fonts. Shaping
returns a binary buffer of glyph identifiers, advances, offsets, and UTF-16 line
break positions. The adapter reads that buffer synchronously and copies data it
must retain before another shaping call overwrites the native result.

`src/owned-shaped.ts` decodes packed shaping. `src/owned-paragraph.ts` composes
width-dependent lines and render buffers; `src/owned-carets.ts` stores caret
geometry. `src/owned-inline.ts` incorporates the numeric metrics of inline atoms.
`src/owned-document.ts` translates paragraph coordinates to document coordinates,
and `src/owned-blocks.ts` provides paragraph-local splice updates.

Text and style changes invalidate shaping for affected paragraphs. Width changes
reuse shaping and rebuild composition. Published snapshots remain readable after
updates or cache release. The editor's `src/editor-canvas/scene.ts` schedules visible
paragraphs first and finishes offscreen work in batches. It retains shaping while
releasing offscreen geometry, then rebuilds that geometry on demand. The scene
accepts immutable text-or-box presentation values and preserves the original
node type in placements. It has no dependency on starter node names, marks or
inline objects. `src/extensions/starter-kit/presentation.ts` translates the
starter schema into text metrics, inline dimensions and estimated block heights.

`src/engines.ts` defines the layout and geometry contracts. `src/layout-types.ts` holds
shared span, position, and direction types and re-exports grapheme boundaries
from the editor core. Neither module contains the former comparison editors.

The layout engine accepts Latin text and supported emoji. The text-support check
rejects unsupported scripts before an edit reaches shaping. General script
fallback and bidirectional layout remain outside the current implementation.

Use `pnpm run check:editor`, `pnpm run check:editor-reflow`, and
`pnpm run check:editor-unicode` for inline geometry, reflow, and supported text
checks. See [viewport reflow](editor-viewport-reflow.md) and
[retained geometry measurements](editor-retained-geometry.md) for the current
scheduler and memory behavior.
