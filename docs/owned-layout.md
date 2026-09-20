# Owned paragraph layout experiment

Open `/owned-layout.html` with the local Vite server running. `npm run spike:owned` builds its WASM and starts the page; `npm run build:owned` produces `dist-owned/`. Existing assets from `npm run setup` are required for the reference engines.

This establishes that we can own paragraph composition and editor geometry while retaining a specialist shaper. It does not establish that replacing Parley is the better production choice.

## Ownership and dependencies

- `native-owned/src/lib.rs` exposes font registration and shaping through a small binary WASM interface. HarfRust 0.3.2 handles OpenType shaping; read-fonts 0.35.0 reads fonts; unicode-linebreak 0.1.5 supplies Unicode line-break opportunities. Cargo.lock pins transitive dependencies. The HarfRust version matches our existing Parley experiment and installed Rust toolchain.
- `src/owned-layout.ts` owns style-run composition, greedy wrapping, glyph positioning, caret affinity, hit testing, navigation, selection rectangles and paragraph shaping caches. `Intl.Segmenter` supplies grapheme boundaries.
- CanvasKit draws the positioned glyphs with the same Noto fonts used by the reference engines. Its paragraph engine is not used by the owned layout implementation. The comparison page still loads both reference engines and all their fonts, so its startup size is not a standalone owned-engine measurement.
- Glyph and Three.js are not used by this implementation. No Glyph source was copied. This is a fresh implementation exploring the proposed ownership boundary, rather than a vendored Glyph fork. Existing Glyph dependencies remain for its separate experiment.

The compiled owned bridge is 776,411 bytes before compression in this build. That excludes fonts, JavaScript and the CanvasKit renderer. Avoid treating it as a complete editor bundle size.

## Data flow

Text and style spans are split at hard paragraph boundaries. Each uncached paragraph is shaped, its glyph clusters are matched to grapheme boundaries, and its legal break opportunities are retained. Width-dependent composition then produces lines, positioned glyphs and per-line caret stops. Existing `Engine` and `LaidOut` interfaces keep this comparable with the other engines.

The bridge returns a three-word header, five words per glyph, and UTF-16 line-break offsets. Advances and offsets are float32 bit patterns. The adapter reads WASM memory synchronously and copies the result into owned JavaScript objects before another WASM call. No JSON serialization crosses this boundary; JSON is currently used only to construct local cache keys and display diagnostics.

Each input id owns a map of the shaped paragraph variants used by its latest successful layout, keyed by text, local styles and size. Width is excluded. The previous map stays readable while the next layout is built, so a large document cannot evict itself during traversal. On success, the new map replaces the old map, releasing removed and superseded variants; a failed layout leaves the previous map intact. Width changes reuse shaping, and an edit shapes only changed paragraphs. Owners call `release(id)` when removing a document or block, or `engine.clear()` to release all retained shaping. Disposing a rendered layout snapshot does not release the document cache.

Memory scales with retained document content, with temporary overlap between old and new layouts. There is no byte budget or viewport eviction yet. Each paragraph now also retains its composed lines, local caret index and prepared glyph/position buffers at the current width. Unchanged paragraphs reuse these objects; edits compose only changed paragraphs. Document placement is rebuilt separately, so moving a paragraph does not rebuild its internal geometry. Resizing still recomposes every affected paragraph. Whole-text scanning and flat line metadata reconstruction remain in the comparison adapter. See [the pipeline ownership decision](owned-pipeline-design.md).

## What works in this slice

Latin text, regular/bold/italic combinations, LF-separated paragraphs, empty paragraphs, greedy wrapping, emergency breaks between shaping clusters, selection rectangles and horizontal/vertical caret navigation. Soft-wrap positions have separate upstream and downstream affinities. Ligature interiors have grapheme caret stops. Formatting boundaries must align with graphemes.

`npm run inspect:owned` runs reproducible browser checks and writes `artifacts/owned-layout.json` and screenshots. Checks cover resize reuse, one-paragraph invalidation, ligature and combining-accent carets, blank and trailing paragraphs, unbroken words, wrap affinity, navigation, styles, unsupported input rejection, width agreement with Parley for a short fixture, actual canvas clicks and width controls, and document retention across insertion, deletion, reordering, release and failed layouts. The current run passes 53 checks in each browser, including composition counts, cross-paragraph interaction and paint-buffer reuse. Chromium, Firefox and WebKit passed the initial run with no page errors.

The script also times one layout of 500 distinct paragraphs in each engine. This is a smoke measurement in fixed engine order, excluding painting and startup. It is not a controlled benchmark or evidence of a performance winner. The owned prototype implements substantially less typography than the reference engines.

## Deliberate limits

- Only Latin scripts and supported common/inherited characters are accepted. Bidi, other scripts, tabs, format controls and unsupported glyphs fail explicitly. There is no fallback font selection.
- Ligature interior carets divide the cluster advance equally among graphemes. They do not use font GDEF caret data. Line breaks preserve whole shaping clusters; a cluster may overflow a very narrow line.
- Shape context is not recomputed at emergency line breaks. Boundary kerning and ligature reshaping need a correctness pass before production use. There is no hyphenation, justification, variable-font control or configurable paragraph typography.
- This is an inspection page with a textarea input, not a third fully integrated editor pane. Canvas clicks inspect carets; dragging, IME, clipboard and structural editing are still provided by the original editor experiment. Selection across a hard newline does not paint a newline box.
- Everything runs synchronously on the main thread. There is no viewport scheduling, partial document loading, worker transport, shared memory or TypeGPU renderer. The comparison still lays out and paints all input.

## Next implementation boundary

Keep immutable shaped paragraphs separate from width-dependent lines and document placement. The next document API should accept changed blocks directly, retain visible paragraph layouts and estimate unloaded block heights. The current comparison adapter still accepts a complete text snapshot. That is where viewport culling and streamed content belong. A worker can own the shaping cache and publish revision-tagged results; `use worker` can handle invocation once the scheduling contract is defined.

Before committing to this engine, compare bidi/fallback complexity and emergency-break correctness against retaining Parley behind a narrower binary bridge. Owning the layout gives control, but also transfers its typography and Unicode maintenance to us.

## Repeated performance measurements

The follow-up [benchmark report](owned-benchmark.md) contains 30-trial median/p95 comparisons for cold application layout, single-paragraph edits and resizing in all three browsers. Run `npm run benchmark:owned` with a server running to reproduce it. It now verifies reuse at both 100 and 500 paragraphs after replacing the bounded shared cache with document-owned retention. The previous results remain in `owned-benchmark-before-retention.md`. It also separates Parley's reported core from total adapter time.
