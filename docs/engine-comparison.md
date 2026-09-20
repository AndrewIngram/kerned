# CanvasKit and Parley experiment

This prototype asks whether either engine can supply the text layout needed for a custom browser editor. It uses real engine output, not DOM text disguised as canvas rendering.

CanvasKit 0.42.0 builds and draws SkParagraph objects. Parley 0.11.1 runs in WebAssembly and returns positioned glyph IDs, line metrics, and editing geometry. Skia draws Parley's glyphs using the exact font files registered with Parley. No text is reshaped with `fillText`.

Both engines use the smaller pane's available width. Each engine receives the same text, styles, font size, and ordered font families. A shared document model owns edits, formatting, selection, and history. Neither engine owns document content.

## What the first run established

Both engines render the prose and multilingual samples in Chromium, Firefox, and WebKit. The multilingual sample includes Arabic, Hebrew, Japanese, Devanagari, combining accents, and joined emoji. Neither engine reports missing characters in these samples.

Parley provides visual cursor movement directly. CanvasKit supplies hit-testing and range geometry, but the adapter builds a visual cursor order from those results. The start-of-paragraph case needs explicit affinity handling.

Parley hit testing returned an offset inside a Devanagari grapheme as defined by the browser's `Intl.Segmenter`. This demonstrates a difference between shaping clusters and the editor's chosen deletion unit. The shared editor snaps pointer positions to grapheme boundaries and skips intermediate movement positions. This is editing policy, not evidence that either library implements every script incorrectly.

Firefox's native textarea Backspace partially deletes a joined family emoji in the tested configuration. The shared editor handles `deleteContentBackward` and `deleteContentForward` through `beforeinput` so both panes delete whole graphemes.

The Rust adapter originally allocated inferred integer elements, then consumed them as bytes. Browser tests exposed the allocator mismatch. The allocator now explicitly creates `u8` elements. Each input allocation is consumed once, and JavaScript refreshes its memory view after allocations that can grow WebAssembly memory.

## How to interpret timing

The benchmark lays out 11,903 UTF-16 units at a common width and font size. It runs four warm-up rounds and twenty measured rounds, alternating engine order. The fixture uses one engine layout containing explicit newlines; it does not measure a sequence of incremental typing transactions.

The displayed core time covers constructing styles, shaping, and line breaking. CanvasKit's core time also includes its JavaScript builder calls. Parley's core clock starts after the request is parsed in Rust. These are useful implementation diagnostics, not identical instrumentation boundaries.

Adapter time measures the synchronous JavaScript layout call through returned geometry. It includes core time. Parley's adapter currently serializes glyph runs as JSON, parses and validates them in JavaScript, and creates drawing arrays. CanvasKit keeps its paragraph object inside its own WebAssembly module. The difference reflects these integration designs as well as the libraries.

The first observations place the core layout costs close together, while the Parley adapter costs more. A binary transfer protocol is worth testing before rejecting Parley on performance. CanvasKit remains the shorter route to an editor because it already includes the drawing path.

`artifacts/inspection.json` records browser versions, the exact benchmark configuration, results, and runtime errors from the latest inspection. Timer resolution, JIT state, caches, and machine load affect these numbers. Sub-resolution observations are labeled rather than presented as zero cost. Draw-submit timings exclude GPU completion and display presentation.

## Structured document exploration

The authoritative document is now a tree of paragraphs, lists with list items, quotes, images, and link cards. Each paragraph owns local formatting spans and a stable ID. `Document` derives a flat UTF-16 projection for the textarea and shared selection. An atomic media block occupies one object-replacement character in that projection. Structural edits publish new snapshots, so undo restores both text and containers.

Document layout walks the tree and supplies each paragraph's content width to either engine. List indentation and quote insets reduce that width. List markers use the same text engine as their pane. Images preserve their aspect ratio and use the shared Skia image decoder; link cards use engine-shaped labels. Media is selectable as one block, with before/after caret positions. Cached decoded images remain alive while referenced by the document or undo/redo history.

This vertical block flow does not currently require Yoga. The useful separation is already visible: document layout owns indentation, spacing, and media boxes; the paragraph engine owns shaping, line breaking, and text geometry. More complex arrangements could justify a general box layout engine later.

The toolbar supports list conversion, nesting and outdenting the current item, quote wrapping, image upload, and link-card insertion. Changing list style within a list changes that list's style. Multi-line plain-text insertion within an item creates paragraphs within that item; Enter explicitly creates a new item. Quote wrapping preserves whole list containers when a selection intersects them.

`npm test` exercises these operations in Chromium, Firefox, and WebKit against both engines, plus model invariants. `node scripts/inspect-structure.mjs` captures the actual structured document, a media insertion, and the narrower toolbar arrangement.

## Boundaries of the experiment

- Layout runs on the main thread. There is no worker or TypeGPU implementation yet.
- Tables, pagination, inline media, text flowing around images, interactive iframe embeds, collaboration, persistence, and rich clipboard formats are outside this prototype. Embeds currently mean canvas-drawn link cards.
- List indent/outdent acts on the current item. Bulk indentation and configurable numbering starts are not implemented.
- The input adapter uses a real textarea, without `contenteditable`. Composition-event tests are synthetic. Native Japanese or Chinese IMEs, candidate placement, dictation, and actual Safari still need manual testing.
- The textarea exposes plain text to assistive technology. Rich document semantics and screen-reader usability are not established.
- Selection and deletion use browser grapheme segmentation. Paragraph base direction is currently left-to-right. Mixed-direction runs are shaped by each engine.
- Modified navigation keys use the textarea's platform behavior. Preferred horizontal position across repeated vertical moves, continuous drag autoscroll, caret blinking, and native word-selection conventions need further work.
- Undo records individual input transactions, with composition updates grouped together. It does not yet group ordinary typing into word-level history entries.
- Font files total about 28.5 MiB, largely due to Japanese and emoji coverage. Both engines eagerly load this deliberately broad fixture. Production font subsetting and lazy loading remain open work.

## Code ownership

| File                   | Responsibility                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `src/model.ts`         | Block tree, input projection, structural commands, formatting, and grapheme policy |
| `src/blocks.ts`        | Atomic block geometry and drawing, decoded image lifetime                          |
| `src/engines.ts`       | CanvasKit integration, validated Parley bridge, and drawing adapters               |
| `native/src/lib.rs`    | Parley font registration, layout cache, and editing geometry                       |
| `src/main.ts`          | Shared input state, pane scrolling, viewport painting, and benchmark controls      |
| `tests/editor.spec.js` | Browser interaction checks against both real engines                               |
| `tests/model.spec.js`  | Immutable editing and structural boundary checks                                   |
| `scripts/inspect.mjs`  | Repeatable screenshots and measurements                                            |

References: [CanvasKit](https://skia.org/docs/user/modules/canvaskit/), [Parley](https://github.com/linebender/parley), and [Yoga's external measurement contract](https://www.yogalayout.dev/docs/advanced/external-layout-systems).
