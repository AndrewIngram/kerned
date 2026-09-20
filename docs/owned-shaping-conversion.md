# Packed shaping conversion experiment

Historical results for the object-to-buffer conversion implementation, before direct decoding. Current reproduction commands run the newer implementation; see [current results](owned-packed-shaping.md). Archived raw measurements are `artifacts/owned-shaping-conversion-validation.json` and `artifacts/owned-shaping-conversion-memory.json`.

Recorded 2026-09-19T13:50:03.641Z, Apple M4 Pro. Memory measured in Chromium 153.0.8010.12.

## Implementation

The opt-in `shaping` variant replaces retained glyph objects, cluster objects, per-cluster arrays and the break Set with numeric columns. Cluster widths use Float64; offsets and range boundaries use Uint32; break flags use Uint8. Glyph data uses the existing packed placement representation. Composition reads those columns directly, with packed carets enabled. The default remains unchanged.

The initial shaping path still creates temporary objects, then packs them. This experiment removes their retention, not their initial allocation. There is no new worker, WASM call, serialization format or SIMD instruction. Packed glyph IDs are shared with composed render runs; old snapshots retain those IDs safely across edits and cache release. Snapshot construction has its own function scope so returned closures cannot retain composition-only shaping data. The memory runner checks that releasing the cache frees the shaping data even while old snapshots remain alive.

## Retained memory

Three fresh pages per variant and size, alternating order. Each page warms the same document and releases it before recording a baseline. Each stage unwinds the evaluation stack and forces GC twice. Values below are median deltas from that baseline, in decimal MB. Backing stores include ArrayBuffers and external strings. JS plus backing is a tracked-memory comparison, not total browser memory or RSS. It excludes parts of native and GPU allocation.

| Paragraphs | Storage | JS heap | Backing stores | Sum |
|---:|---|---:|---:|---:|
| 500 | carets | 10.85 | 1.30 | 12.15 |
| 500 | shaping | 1.81 | 3.13 | 4.94 |
| 2000 | carets | 43.62 | 5.27 | 48.89 |
| 2000 | shaping | 6.98 | 12.73 | 19.71 |

Both arms use packed carets. The difference measures replacement of retained shaping objects plus use of packed glyph placement. It does not isolate cluster packing from glyph placement. Exact `shapingBufferBytes` includes glyph ID buffers also referenced by composed runs, so it must not be added to `glyphBufferBytes` without deduplicating shared buffers.

## Lifecycle

| Paragraphs | Storage | Loaded | Two snapshots | After 50 edits | Cache released | Snapshots dropped | After 10 release cycles |
|---:|---|---:|---:|---:|---:|---:|---:|
| 500 | carets | 12.15 | 14.46 | 14.48 | 4.57 | 0.07 | 0.07 |
| 500 | shaping | 4.94 | 7.13 | 7.17 | 4.46 | 0.08 | 0.08 |
| 2000 | carets | 48.89 | 58.16 | 58.19 | 18.13 | 0.05 | 0.05 |
| 2000 | shaping | 19.71 | 28.49 | 28.52 | 17.65 | 0.05 | 0.06 |

All trials return backing stores to the warmed baseline after cache and snapshots are released. Small residual JS deltas remain. The native shaping module keeps the same linear-memory size at every stage in each trial. These checks cover this lifecycle, not every possible leak.

## Correctness and timing

Validation compares the new variant with the original object implementation, including independent Parley width checks. Timing compares packed carets against packed shaping, with six warmups and 30 measured trials per scenario, alternating order. Cold and edit timings include packing. No drawing or startup is timed. Zero medians in Firefox/WebKit reflect timer resolution.

| Browser | Cases | Assertions | Pixel comparisons | Failures |
|---|---:|---:|---:|---:|
| chromium | 258 | 158696 | 12 | 0 |
| firefox | 258 | 158696 | 12 | 0 |
| webkit | 258 | 158696 | 12 | 0 |

Font sizes 8, 12, 20, 37.5, 72 and 128; widths 1, 16, 120, 333.3, 800 and 2400. Documents include empty and blank paragraphs, whitespace, ligatures, combining accents, long words, styled text, up to 2,000 paragraphs and a long single paragraph. Pixel checks use offscreen DPR 1, 1.5 and 2. Lifetime checks cover edits, reordering, release, failed layout and old snapshots. The existing Latin/LTR limitation remains.

| Browser | Fixture | Operation | Packed carets median / p95 ms | Packed shaping median / p95 ms |
|---|---|---|---:|---:|
| chromium | 100 paragraphs | cold | 1.90 / 2.20 | 2.30 / 2.70 |
| chromium | 100 paragraphs | edit | 0.10 / 0.20 | 0.10 / 0.10 |
| chromium | 100 paragraphs | resize | 0.50 / 0.60 | 0.40 / 0.50 |
| chromium | 500 small-text paragraphs | cold | 10.85 / 11.90 | 12.50 / 13.00 |
| chromium | 500 small-text paragraphs | edit | 0.20 / 0.30 | 0.20 / 0.30 |
| chromium | 500 small-text paragraphs | resize | 3.70 / 3.90 | 1.90 / 2.60 |
| chromium | 500 large-text paragraphs | cold | 10.85 / 12.00 | 12.50 / 13.10 |
| chromium | 500 large-text paragraphs | edit | 0.20 / 0.30 | 0.20 / 0.30 |
| chromium | 500 large-text paragraphs | resize | 2.55 / 4.00 | 1.80 / 2.60 |
| chromium | one long paragraph | cold | 2.20 / 2.40 | 2.60 / 2.70 |
| chromium | one long paragraph | edit | 2.00 / 2.80 | 2.30 / 3.10 |
| chromium | one long paragraph | resize | 0.60 / 1.30 | 0.30 / 0.40 |
| firefox | 100 paragraphs | cold | 3.00 / 5.00 | 4.00 / 6.00 |
| firefox | 100 paragraphs | edit | 0.00 / 1.00 | 0.00 / 1.00 |
| firefox | 100 paragraphs | resize | 1.00 / 2.00 | 0.00 / 1.00 |
| firefox | 500 small-text paragraphs | cold | 14.00 / 20.00 | 15.50 / 21.00 |
| firefox | 500 small-text paragraphs | edit | 0.00 / 1.00 | 0.00 / 1.00 |
| firefox | 500 small-text paragraphs | resize | 5.00 / 11.00 | 3.00 / 7.00 |
| firefox | 500 large-text paragraphs | cold | 15.00 / 19.00 | 16.00 / 22.00 |
| firefox | 500 large-text paragraphs | edit | 0.00 / 1.00 | 0.00 / 1.00 |
| firefox | 500 large-text paragraphs | resize | 5.00 / 12.00 | 3.00 / 8.00 |
| firefox | one long paragraph | cold | 3.00 / 4.00 | 4.00 / 5.00 |
| firefox | one long paragraph | edit | 3.00 / 5.00 | 3.00 / 5.00 |
| firefox | one long paragraph | resize | 1.00 / 2.00 | 1.00 / 2.00 |
| webkit | 100 paragraphs | cold | 2.00 / 3.00 | 2.00 / 3.00 |
| webkit | 100 paragraphs | edit | 0.00 / 0.00 | 0.00 / 0.00 |
| webkit | 100 paragraphs | resize | 1.00 / 1.00 | 0.00 / 1.00 |
| webkit | 500 small-text paragraphs | cold | 9.00 / 11.00 | 10.00 / 12.00 |
| webkit | 500 small-text paragraphs | edit | 0.00 / 1.00 | 0.00 / 1.00 |
| webkit | 500 small-text paragraphs | resize | 2.00 / 3.00 | 1.00 / 2.00 |
| webkit | 500 large-text paragraphs | cold | 9.00 / 9.00 | 10.00 / 11.00 |
| webkit | 500 large-text paragraphs | edit | 0.00 / 1.00 | 0.00 / 1.00 |
| webkit | 500 large-text paragraphs | resize | 2.00 / 3.00 | 1.00 / 2.00 |
| webkit | one long paragraph | cold | 2.00 / 3.00 | 2.00 / 3.00 |
| webkit | one long paragraph | edit | 2.00 / 2.00 | 2.00 / 3.00 |
| webkit | one long paragraph | resize | 1.00 / 1.00 | 0.00 / 1.00 |

## Assessment

Packing the retained shaping data lowers retained memory and generally speeds recomposition in this run. Cold layout is slower in several fixtures, and long-paragraph edits can also pay the conversion cost. Keep this opt-in until the initial-load tradeoff is addressed. The next experiment should decode shaping results directly into owned buffers, avoiding the temporary object graph and second packing pass. That can stay in TypeScript using the existing binary shaping boundary.

## Reproduce

Run `npm run build:owned` and serve the owned production preview on port 5175. Run `OWNED_VARIANT=shaping node scripts/validate-owned-sizes.mjs`, then `OWNED_VARIANT=shaping node scripts/measure-owned-memory.mjs`, then `node scripts/report-owned-shaping.mjs`. Use `OWNED_URL` for another server. Run benchmarks without competing workloads. Raw artifacts are `artifacts/owned-shaping-validation.json` and `artifacts/owned-shaping-memory.json`.
