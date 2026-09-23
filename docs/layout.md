# Editor layout pipeline

`editor.html` uses the layout engine in `packages/view/src/internal/owned-layout.ts` with packed shaping.
CanvasKit draws positioned glyphs; HarfRust shapes text through
`native-owned/src/lib.rs`. TypeScript owns paragraph wrapping, caret positions,
selection geometry, and block placement.

The bridge registers the configured font catalog, including emoji fallback. The default catalog supplies regular, bold, italic and bold-italic text faces. Shaping
returns a binary buffer of glyph identifiers, advances, offsets, and UTF-16 line
break positions. The adapter reads that buffer synchronously and copies data it
must retain before another shaping call overwrites the native result.

`packages/view/src/internal/owned-shaped.ts` decodes packed shaping. `packages/view/src/internal/owned-paragraph.ts` composes
width-dependent lines and render buffers; `packages/view/src/internal/owned-carets.ts` stores caret
geometry. `packages/view/src/internal/owned-inline.ts` incorporates the numeric metrics of inline atoms.
`packages/view/src/internal/owned-document.ts` translates paragraph coordinates to document coordinates,
and `packages/view/src/internal/owned-blocks.ts` provides paragraph-local splice updates.

Text and style changes invalidate shaping for affected paragraphs. Width changes
reuse shaping and rebuild composition. Published snapshots remain readable after
updates or cache release. The editor's `packages/view/src/canvas/scene.ts` schedules visible
paragraphs first and finishes offscreen work in batches. It retains shaping while
releasing offscreen geometry, then rebuilds that geometry on demand. The scene
accepts immutable text-or-box presentation values and preserves the original
node type in placements. It has no dependency on starter node names, marks or
inline objects. `packages/extension-document/src/presentation.ts` translates the
starter schema into text metrics, inline dimensions and estimated block heights.

`packages/view/src/internal/engines.ts` defines the layout and geometry contracts. `packages/view/src/internal/layout-types.ts` holds
shared span, position, and direction types and re-exports grapheme boundaries
from the editor core. Neither module contains the former comparison editors.

These files are private implementations of `mountEditor` from `@kerned/view`; consumers do not create an engine directly.

The layout engine accepts Latin, Greek, Cyrillic, Arabic, Hebrew and supported
emoji. Directional scripts use retained Unicode bidi analysis, coverage-based font
fallback and contextual run shaping. Logical model offsets remain unchanged;
selection geometry follows visual runs. Unsupported scripts are rejected before
an edit reaches shaping. See [international text](research-international-text.md).

Use `pnpm run check:editor`, `pnpm run check:editor-reflow`, and
`pnpm run check:editor-unicode` for inline geometry, reflow, and supported text
checks. See [viewport reflow](editor-viewport-reflow.md) and
[retained geometry measurements](editor-retained-geometry.md) for the current
scheduler and memory behavior.
