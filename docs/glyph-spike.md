# Glyph spike findings

Tested 2026-09-19. Published `@pmndrs/glyph@0.1.0`, Three.js 0.185.0, MSDF rendering through Three's WebGPURenderer forced to WebGL2. The existing editor remains unchanged.

## Verdict

Keep Glyph as an experimental candidate, not a replacement for either current adapter. It renders the tested prose and mixed Arabic/Hebrew sample convincingly, but it needs additional editor caret policy and does not show an update-performance advantage in this integration. Font preparation also hit a concrete failure on our CJK fixture. Direct TypeGPU, other raster techniques, and optimized layout-only integration could have different results.

## Run it

After the normal `npm run setup`:

```sh
npm run setup:glyph
npm run spike:glyph
```

Open `/glyph-spike.html`. The three canvases share text, width, and size. Selecting in the textarea draws each engine's selection rectangles. Clicking a canvas reports its native hit result, without snapping Glyph's result to hide cluster differences. Keyboard navigation remains the textarea's behavior, not a claim of native Glyph visual navigation. There is no full document editor, IME validation, virtualization, or streaming implementation in this spike.

With the dev server running, `npm run inspect:glyph` records measurements and screenshots. `npm run build:glyph` builds a separate `dist-glyph-spike` output without adding Glyph to the original editor's bundle.

## Editing and rendering observations

- Chromium, Firefox, and WebKit initialize and render all the fixture runs. The prose has seven lines and no missing glyphs in all three engines at 600 px width and 20 px size. The mixed Arabic/Hebrew fixture has no missing glyphs. Screenshots at device pixel ratios 1 and 2 show broadly similar placement; this was visual inspection, not a pixel-equivalence assertion.
- Dense native hit sampling of `office` returns offsets `[0, 1, 4, 5, 6]` from Glyph in every browser. Its `ffi` ligature is one hit-test cluster. An editor that allows insertion at every grapheme boundary needs an additional caret policy and geometry inside that cluster.
- The mixed-script sample produces two sampled native hit results inside browser-defined Devanagari graphemes. We already normalize engine positions in our editor; Glyph needs that policy too. These observations distinguish shaping clusters from the editor's grapheme unit, rather than asserting that its shaping is wrong.
- Selection rectangles render for the mixed-direction sample. This small fixture does not establish correctness for every bidi boundary, wrap affinity, empty-line caret, or partial-ligature selection.
- The multilingual fixture reports 49 missing glyphs in Glyph with this asset set. CJK preparation failed and no color-emoji asset was provided; the number is not evidence that its advertised horizontal CJK shaping is absent. The regular ligature/emoji fixture also includes unsupported emoji.
- The initial benchmark created transient Three text objects without scene attachment and encountered `invalid-request` publication failures. A separate probe with scene attachment, publication, removal, disposal, and another publication passes for both short and long text in all browsers. The invalid setup's partial output is retained in `artifacts/glyph-spike-lifecycle-failure.json` for traceability; it is superseded, not evidence of a confirmed Glyph defect.

## Update timings

Median of 20 measurements after four warmups, rotating engine order. Long workload: 11,903 UTF-16 units in one layout object with explicit newlines, 20 px type. Edit alternates adding/removing one final character at width 600; resize alternates width 300/600 without text changes.

| Browser | Operation | CanvasKit | Parley | Glyph |
| --- | --- | --- | --- | --- |
| chromium | edit | 3.2 ms | 5.6 ms | 13.5 ms |
| chromium | resize | 3.4 ms | 6.9 ms | 9.9 ms |
| firefox | edit | 4.0 ms | 7.0 ms | 14.0 ms |
| firefox | resize | 4.0 ms | 8.0 ms | 9.0 ms |
| webkit | edit | 3.0 ms | 6.0 ms | 14.0 ms |
| webkit | resize | 4.0 ms | 6.0 ms | 9.0 ms |

These are synchronous adapter costs through a full-document selection geometry query, excluding drawing and GPU completion. Glyph updates a retained Three text object, publishes its render plan, requests glyph inspection, and reads selection geometry. The existing adapters rebuild their paragraph objects. These are useful integration comparisons, not isolated shaper benchmarks. A whole-document selection is deliberately demanding; ordinary caret-only typing may cost less. Retained caches, alternative query paths, or a layout-only Glyph adapter may improve its numbers.

The small prose cases are often below meaningful timer resolution in Firefox and WebKit. A reported zero means below clock resolution, not free work. Draw-submit costs on this small viewport are likewise too small for a reliable ranking. No GPU-completion benchmark was performed.

## Initial load and font assets

Seven prepared font assets total 19.15 MiB before HTTP compression. A forced local preparation run took 29.8 seconds for those successful assets. These MSDF assets are subsetted to ASCII, Latin-1, combining marks, and characters in the source fixtures. This is not equivalent coverage to our original 28.5 MiB Noto bundle, and it is not a universal font-size or startup win.

The published subset/MSDF bake path fails on `NotoSansCJKjp-Regular.otf` with `font has no glyf, CFF, or CFF2 outline table to generate a field from`. The setup script preserves the failure in `public/glyph-spike/manifest.json`. The seven successful fonts remain usable. We have not established whether a different raster technique, unsubsetted bake, or upstream source revision fixes this path.

Recorded startup timings are local first-page visits with OS caches, not throttled-network cold-load measurements. They initialize the existing engines first and Glyph second, so the combined readiness number is not Glyph-alone first paint. Font loading, WASM initialization, and renderer initialization are recorded separately. Offline preparation is not included in browser startup.

The built Chromium check requested WebGPU separately but selected WebGL2 fallback. Therefore all verified rendering/performance findings here concern Three/MSDF/WebGL2. Direct TypeGPU and a real WebGPU execution remain unmeasured.

## Evidence and validation

- `artifacts/glyph-spike.json`: final three-browser fixtures, native hits, update samples, startup phases, draw-submit samples, and lifecycle results.
- `artifacts/glyph-production.json`: standalone production-build startup and requested/actual backend.
- `public/glyph-spike/manifest.json`: asset sizes, preparation durations, and the CJK failure.
- `artifacts/*-glyph-prose.png`, `*-glyph-bidi.png`, `*-glyph-dpr2.png`: visual evidence.
- Both original and standalone builds succeeded; all 69 existing editor/model checks passed.

The next practical step is to continue the CanvasKit/Parley large-document work. A future Glyph experiment should isolate its layout/query cost from renderer publication, or evaluate its renderer with Parley positions, before investing in a full editor adapter.
