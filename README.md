# Run the canvas editor experiment

This disposable prototype compares CanvasKit and Parley in paired, editable canvases. Both panes share one document and the same font files.

## Start locally

Use Node 22.12 or later, npm, and Rust 1.93.1 or later.

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run setup
npm run dev
```

Open the local URL printed by Vite. Setup downloads the Noto fonts, checks their SHA-256 hashes, copies CanvasKit's WebAssembly module, and compiles Parley.

The initial **Lists, quotes & embeds** document exercises nested numbered and bullet lists, a quote with multiple paragraphs, and a link card. Use the visible toolbar to apply these structures to your own text.

- **Enter** splits a list item; **Tab / Shift+Tab** nests or lifts the current item. Enter on an empty item lifts it out of the list. Backspace at the start of an item outdents it.
- **Quote** wraps selected blocks. Enter on an empty quote paragraph returns to ordinary text.
- **Image** inserts a local PNG, JPEG, or WebP with a description. **Embed** inserts an HTTP(S) link card. Click either block to select it, then delete it or use **Remove block**. Deleting beside a media block selects it first. Link cards have an **Open link** action.
- Undo and redo include structural edits and media. Images and document changes stay in this tab; there is no persistence or rich clipboard yet.

Select **Languages & emoji** to compare complex text. Click either canvas to type. Drag to select text, then use **Bold**, **Italic**, or the usual keyboard shortcuts. Changes stay in memory and disappear on reload.

Select **100 paragraphs** to exercise scrolling. Change **Type size** or resize the window to trigger reflow. Enable **Show line bounds** to inspect baselines and line boxes.

Click **Measure layout** for a fixed workload with alternating engine order. This measurement excludes drawing and font loading.

## Verify changes

```sh
npm run build
npx playwright install chromium firefox webkit
npm test
```

With the local server running, capture screenshots and measurements:

```sh
node scripts/inspect.mjs
node scripts/inspect-structure.mjs
```

Results go into `artifacts/`. The browser tests cover shared editing, canvas hit testing, formatting, undo and redo, grapheme deletion, cursor movement, mixed-script selections, resizing, long-document scrolling, simulated composition events, nested list commands, quote boundaries, and media insertion, navigation, deletion, and undo. Pure model checks cover style preservation and immutable structural edits.

Read [the comparison notes](docs/engine-comparison.md) before treating the results as a production recommendation.

## Glyph spike

A separate third-engine experiment is available at `/glyph-spike.html`. Run `npm run setup:glyph`, then `npm run spike:glyph`. It uses pinned Glyph 0.1.0 and Three.js 0.185.0 without changing the original editor. See [the findings and limitations](docs/glyph-spike.md); `npm run inspect:glyph` reproduces the browser measurements.

## Owned layout experiment

Run `npm run spike:owned` and open `/owned-layout.html` to compare our own paragraph layout against CanvasKit and Parley. It uses a separate HarfRust shaping bridge and keeps width-dependent wrapping and editor geometry in TypeScript. `npm run inspect:owned` checks all three browsers. See [scope, results and limitations](docs/owned-layout.md).

For repeated performance measurements, run `npm run benchmark:owned` against the local server. See [median/p95 results and methodology](docs/owned-benchmark.md). Set `OWNED_URL` to benchmark a served production build instead.

`npm run validate:owned` runs the size/width/document-length sweep and compares the object path against an experimental packed typed-array positioning path. It defaults to the production preview on port 5175. See [coverage and measured tradeoffs](docs/owned-size-validation.md); regenerate the report with `node scripts/report-owned-sizes.mjs`.

For Chromium CPU and sampled-allocation diagnostics, run `npm run profile:owned` against the dev server on port 5173. Regenerate the analysis with `node scripts/report-owned-profile.mjs`. `npm run benchmark:storage` separately repeats the unprofiled storage comparison against the production preview on port 5175. See [the profiling findings](docs/owned-profiling.md).

The separate packed-caret experiment is documented in [caret storage results](docs/owned-carets.md). `npm run check:carets` verifies equivalence and measures interaction queries; `OWNED_VARIANT=carets npm run validate:owned` measures paired layout workloads.

`npm run memory:owned` measures post-GC retained heap and backing stores across document sizes, widths, edits and snapshot release. See [retained-memory results](docs/owned-retained-memory.md); regenerate that report with `node scripts/report-owned-memory.mjs`.

The opt-in packed-shaping variant replaces retained glyph/cluster objects with typed arrays. Run `OWNED_VARIANT=shaping npm run validate:owned` and `OWNED_VARIANT=shaping npm run memory:owned`, then `node scripts/report-owned-shaping.mjs`. See [memory, timing and correctness results](docs/owned-packed-shaping.md).

Large-document validation covers 2,000/10,000 plain and styled paragraphs, completed-paragraph chunks, and character fragments. Run `node scripts/check-owned-large.mjs`, `node scripts/check-owned-fragments.mjs`, then `node scripts/report-owned-large.mjs` against the owned production preview. See [loading, update and memory results](docs/owned-large-documents.md).

The owned engine also exposes `createBlockDocument({ width, size })` for paragraph-local splice updates. Run `node scripts/check-owned-blocks.mjs`, `node scripts/check-owned-blocks-large.mjs`, then `node scripts/report-owned-blocks.mjs`. See [the API contract and measurements](docs/owned-block-updates.md). The comparison UI still uses the whole-document API.

The owned snapshot supports viewport drawing via `drawViewport`. Run `node scripts/check-owned-viewport.mjs` and `node scripts/report-owned-viewport.mjs` for pixel equivalence, draw timings and the adaptive chunk experiment. See [viewport results](docs/owned-viewport.md) and [the proposed React extension architecture](docs/react-extensions.md). The separate [React extension spike](docs/react-extensions-spike.md) is now implemented.

Run `npm run spike:hybrid` and open `/hybrid-editor.html` for canvas text with interactive React blocks, atomic mentions and comment panels. `npm run build:hybrid` produces `dist-hybrid`; serve it with `npx vite preview --config vite.hybrid.config.ts --port 5176`. `npm run check:hybrid` validates the production preview across Chromium, Firefox and WebKit.

Choose **Warbreaker** in the hybrid editor's **Sample** selector, or open `/hybrid-editor.html?sample=warbreaker`. The [trimmed sample](public/samples/warbreaker.html) covers the Prologue through Ars Arcanum; the [complete converted file](public/samples/warbreaker-full.html) retains the introduction, rights and other supplemental material. The editor imports 7,279 root blocks with bold, italic, underline and an editable table. See [conversion, importer limits and verification](docs/html-samples.md). Run `npm run check:hybrid-book` and `npm run check:hybrid-table` to verify the book in all three browsers.

Choose **War and Peace** for a larger public-domain sample, or open `/editor.html?sample=war-and-peace`. The [complete novel](public/samples/war-and-peace.html), translated by Louise and Aylmer Maude, has 562,489 words and 11,718 blocks. Books and chapters appear in the outline. The [original download](public/samples/war-and-peace-full.html) retains Gutenberg's credits and licence. Run `node scripts/convert-war-and-peace.mjs` to regenerate the sample and `npm run check:war-and-peace` to verify it in all three browsers.

For 10,000 mixed blocks arriving incrementally, open `/hybrid-editor.html?stream=10000`. Run `npm run check:hybrid-large` for interaction and reflow validation, then `npm run benchmark:hybrid-large` and `node scripts/report-hybrid-large.mjs` for [loading, resizing and retained-memory results](docs/hybrid-large-documents.md).

Width and zoom changes now reflow the viewport first, then finish offscreen work in batches. Run `npm run check:hybrid-reflow`, `npm run benchmark:hybrid-reflow`, and `node scripts/report-hybrid-reflow.mjs` for [the paired results and correctness checks](docs/hybrid-viewport-reflow.md). Add `reflow=eager` to the demo URL for the synchronous comparison.

The hybrid editor now compacts caret buffers and releases offscreen layout geometry while retaining shaping. Run `npm run memory:hybrid` for [memory reductions, scroll costs and validation](docs/hybrid-retained-geometry.md). Use `retention=all` for the full-geometry comparison.

The hybrid editor supports transaction-based paragraph split/join and grouped undo. Run `npm run check:transactions` for [the editing core, durable-anchor format and collaboration boundaries](docs/editor-transactions-and-anchors.md).

The editing core is schema-independent. See [the public extension boundary](docs/editor-extension-boundary.md) for node capabilities, mention/comment APIs, React canvas registration, and schema ownership. Run `npm run check:editor-boundaries` to enforce the dependency boundary.

Generic containers and a headless nested-list extension now use that public boundary. See [structural operations, list commands, measurements and the table-selection prerequisite](docs/editor-containers-and-lists.md). Run `npm run benchmark:containers` against the hybrid production preview to measure transaction application directly.

The [selection protocol](docs/editor-selections.md) provides cross-block text, node, whole-document and custom selections, with history bookmarks and stable-key codecs. A headless table extension validates cell ranges and spans; the hybrid demo supports text selections across paragraphs.

For a quick pointer-input regression check against the dev server, run `npm run check:hybrid-pointer`. It clicks canvas text, types, drags a selection, replaces it and undoes the edit at 100% and 150% zoom in Chromium, Firefox and WebKit. Set `HYBRID_URL` to test another server. Run `npm run check:hybrid-cross-selection` for cross-paragraph copy, replacement, deletion, keyboard extension and undo.

## Minimal editor demo

Run `npm run demo` and open `/editor.html`. The clean writing view uses the same canvas editor as `/hybrid-editor.html`, which retains the sample picker and diagnostics. Select text to apply bold or italic from the toolbar (or Cmd/Ctrl+B and Cmd/Ctrl+I); both support undo and redo. Formatting currently requires a nonempty selection. Add `?sample=warbreaker` to load the book in the minimal view.

The minimal demo uses page scrolling with a sticky toolbar and a viewport-sized canvas. Run `npm run check:editor-demo` for desktop and mobile browser checks, and `npm run check:editor-page-scroll` for scrolling, hit testing after scrolling, and viewport resizing.

In the canvas editor, double-click selects a word, triple-click selects its paragraph, and Cmd/Ctrl+A selects the document text across paragraphs. Embedded form controls keep their native select-all behavior. Run `npm run check:editor-multiclick` to verify these interactions and replacement undo.

The sample picker switches documents in place, retains loaded engine/font assets, caches each imported book separately, and supports browser Back/Forward. Switching resets sample edits and undo history. Run `npm run check:editor-samples` to verify navigation and network requests.

The toolbar includes underline, clear formatting and comments on canvas text selections. **Blocks** toggles block quotes, bullet lists and numbered lists, and inserts editable tables. See [current extension behavior and limits](docs/editor-block-ui.md). Run `npm run check:editor-blocks`, `npm run check:editor-tables` and `npm run check:text-commands`.

### Heading typography

The editor’s Blocks menu includes Paragraph and Heading 1–4. Heading nodes use a
separate starter-kit extension and retain the same text editing, selections and
transaction history as paragraphs. Enter at the end starts a normal paragraph.

The 18px body uses a 28px line height. H1–H4 use 36/44, 28/36, 24/32 and 20/28px
size/line-height pairs. Canvas baselines and block spacing align to a 4px grid;
adjacent block margins collapse to the larger value, and the first block has no
extra heading margin. Tokens live in `src/extensions/typography.ts`.

Run `npm run check:editor-headings` for desktop/mobile editing and import checks
in Chromium, Firefox and WebKit.
