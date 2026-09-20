# Large documents and incremental loading

Recorded 2026-09-19T13:57:51.348Z, Apple M4 Pro.

## What was tested

2,000 and 10,000 distinct paragraphs, roughly 116 characters each, at 20px with 480px text width. Styled fixtures have two spans per paragraph and five font runs, plus the base shaping call used for line breaks. Both variants use packed carets; `shaping` also decodes directly into packed glyph/cluster storage. The editor default is unchanged.

Each case uses one fresh page and engine, an untimed full-document warmup, then three cold-cache and streamed trials. Cases run sequentially; variant order reverses between plain and styled fixtures. This is a small exploratory sample, not a statistical regression gate. Cold timings exclude fixture construction, transport, font download and WASM initialization. Streaming times include JSON parsing of locally generated chunks, reconstruction of full text and spans, layout, canvas drawing and flush. Chunks contain completed paragraphs: 100 at a time for 2,000 paragraphs and 500 for 10,000. Each delivery yields with setTimeout(0). There is no network simulation.

Rendering uses a fixed 500×640 CanvasKit software surface. First submission means the first chunk has been drawn and flushed; it is not a browser presentation/FCP measurement. Draw timings exclude PNG encoding. The existing draw method still submits every paragraph, even outside the surface. These tests measure clipping, not viewport culling.

## Loading

Median over three trials, milliseconds. Cold is layout alone; first submission includes parsing, assembly, layout and drawing. Work sums chunk-update durations, excluding between-chunk yields. Last update shows accumulated-document overhead. Worst is the slowest individual update across all trials.

| Browser | Paragraphs | Styled | Storage | Cold layout | First submission | Total stream work | Final submission elapsed | Last update | Worst update |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|
| chromium | 2000 | no | carets | 68.6 | 5.5 | 127.6 | 193.5 | 8.3 | 12.1 |
| chromium | 2000 | no | shaping | 54.5 | 3.6 | 118.7 | 186.8 | 7.9 | 8.4 |
| chromium | 2000 | yes | shaping | 147.7 | 6.7 | 568.7 | 636.5 | 58.9 | 61.1 |
| chromium | 2000 | yes | carets | 135.3 | 7.0 | 406.5 | 475.1 | 34.1 | 34.9 |
| chromium | 10000 | no | carets | 348.2 | 18.3 | 588.7 | 653.4 | 40.5 | 40.9 |
| chromium | 10000 | no | shaping | 292.6 | 14.4 | 503.0 | 573.2 | 35.8 | 36.1 |
| chromium | 10000 | yes | shaping | 816.1 | 35.7 | 3250.1 | 3324.5 | 353.9 | 358.2 |
| chromium | 10000 | yes | carets | 1069.6 | 37.0 | 3364.0 | 3439.6 | 361.8 | 383.1 |
| firefox | 2000 | no | carets | 82.0 | 6.0 | 164.0 | 259.0 | 14.0 | 19.0 |
| firefox | 2000 | no | shaping | 70.0 | 5.0 | 151.0 | 246.0 | 10.0 | 14.0 |
| firefox | 2000 | yes | shaping | 173.0 | 8.0 | 620.0 | 710.0 | 66.0 | 67.0 |
| firefox | 2000 | yes | carets | 199.0 | 10.0 | 658.0 | 752.0 | 63.0 | 68.0 |
| firefox | 10000 | no | carets | 403.0 | 22.0 | 671.0 | 769.0 | 43.0 | 61.0 |
| firefox | 10000 | no | shaping | 338.0 | 20.0 | 616.0 | 706.0 | 44.0 | 49.0 |
| firefox | 10000 | yes | shaping | 1558.0 | 39.0 | 8026.0 | 8117.0 | 987.0 | 999.0 |
| firefox | 10000 | yes | carets | 1714.0 | 45.0 | 8088.0 | 8182.0 | 987.0 | 991.0 |
| webkit | 2000 | no | carets | 57.0 | 4.0 | 110.0 | 165.0 | 7.0 | 26.0 |
| webkit | 2000 | no | shaping | 44.0 | 3.0 | 84.0 | 152.0 | 6.0 | 6.0 |
| webkit | 2000 | yes | shaping | 108.0 | 6.0 | 365.0 | 434.0 | 33.0 | 35.0 |
| webkit | 2000 | yes | carets | 136.0 | 8.0 | 388.0 | 451.0 | 36.0 | 37.0 |
| webkit | 10000 | no | carets | 292.0 | 18.0 | 468.0 | 550.0 | 31.0 | 33.0 |
| webkit | 10000 | no | shaping | 212.0 | 12.0 | 374.0 | 444.0 | 26.0 | 27.0 |
| webkit | 10000 | yes | shaping | 1217.0 | 28.0 | 3514.0 | 3611.0 | 400.0 | 423.0 |
| webkit | 10000 | yes | carets | 871.0 | 39.0 | 3689.0 | 3814.0 | 418.0 | 422.0 |

## Update and draw diagnostics

Single observations after the loading trials, not timing distributions. Top/middle/bottom draws use the same fixed-size surface. Unchanged and edit timings include the current whole-document input processing.

| Browser | Paragraphs | Styled | Storage | Unchanged ms | One-paragraph edit ms | Resize ms | Top / middle / bottom draw ms |
|---|---:|---|---|---:|---:|---:|---|
| chromium | 2000 | no | carets | 4.3 | 4.1 | 18.4 | 1.5 / 1.4 / 1.4 |
| chromium | 2000 | no | shaping | 3.4 | 3.4 | 14.4 | 1.5 / 1.4 / 1.5 |
| chromium | 2000 | yes | shaping | 55.9 | 53.2 | 61.2 | 2.8 / 2.6 / 2.6 |
| chromium | 2000 | yes | carets | 58.1 | 54.7 | 64.6 | 2.6 / 2.5 / 2.6 |
| chromium | 10000 | no | carets | 22.0 | 22.3 | 88.6 | 4.6 / 4.4 / 6.3 |
| chromium | 10000 | no | shaping | 18.2 | 18.4 | 96.4 | 7.0 / 5.2 / 5.3 |
| chromium | 10000 | yes | shaping | 423.9 | 308.7 | 428.0 | 10.6 / 10.6 / 10.6 |
| chromium | 10000 | yes | carets | 461.9 | 320.0 | 476.1 | 10.8 / 10.6 / 11.2 |
| firefox | 2000 | no | carets | 4.0 | 4.0 | 28.0 | 3.0 / 2.0 / 2.0 |
| firefox | 2000 | no | shaping | 4.0 | 3.0 | 19.0 | 2.0 / 2.0 / 2.0 |
| firefox | 2000 | yes | shaping | 51.0 | 57.0 | 78.0 | 5.0 / 3.0 / 4.0 |
| firefox | 2000 | yes | carets | 50.0 | 52.0 | 77.0 | 3.0 / 4.0 / 4.0 |
| firefox | 10000 | no | carets | 19.0 | 21.0 | 170.0 | 6.0 / 6.0 / 9.0 |
| firefox | 10000 | no | shaping | 19.0 | 18.0 | 98.0 | 6.0 / 6.0 / 7.0 |
| firefox | 10000 | yes | shaping | 930.0 | 957.0 | 1036.0 | 17.0 / 13.0 / 14.0 |
| firefox | 10000 | yes | carets | 926.0 | 936.0 | 1122.0 | 14.0 / 14.0 / 14.0 |
| webkit | 2000 | no | carets | 2.0 | 2.0 | 13.0 | 1.0 / 2.0 / 1.0 |
| webkit | 2000 | no | shaping | 1.0 | 2.0 | 7.0 | 2.0 / 1.0 / 2.0 |
| webkit | 2000 | yes | shaping | 25.0 | 25.0 | 33.0 | 2.0 / 3.0 / 3.0 |
| webkit | 2000 | yes | carets | 26.0 | 25.0 | 39.0 | 3.0 / 2.0 / 3.0 |
| webkit | 10000 | no | carets | 12.0 | 8.0 | 67.0 | 6.0 / 44.0 / 7.0 |
| webkit | 10000 | no | shaping | 9.0 | 7.0 | 43.0 | 5.0 / 5.0 / 5.0 |
| webkit | 10000 | yes | shaping | 406.0 | 385.0 | 399.0 | 10.0 / 10.0 / 11.0 |
| webkit | 10000 | yes | carets | 396.0 | 377.0 | 428.0 | 13.0 / 12.0 / 11.0 |

## Retained memory

Chromium only. One post-GC sample per case after all three stream trials. Baseline follows a full-document warmup and cache release. Values are JS used heap plus backing stores relative to baseline, in decimal MB; this is not total browser/native/GPU memory or peak memory. Fixture text and spans already exist at baseline.

| Paragraphs | Styled | Storage | Retained MB | After release MB | Backing-store delta after release |
|---:|---|---|---:|---:|---:|
| 2000 | no | carets | 84.20 | 0.18 | 0 |
| 2000 | no | shaping | 30.52 | 0.18 | 0 |
| 2000 | yes | shaping | 31.63 | 0.18 | 0 |
| 2000 | yes | carets | 85.77 | 0.18 | 0 |
| 10000 | no | carets | 422.00 | 0.19 | 0 |
| 10000 | no | shaping | 152.46 | 0.18 | 0 |
| 10000 | yes | shaping | 158.01 | 0.18 | 0 |
| 10000 | yes | carets | 429.78 | 0.18 | 0 |

## Correctness

All cases check that only newly arrived paragraphs shape and compose, unchanged inputs reuse all shaping/composition, one edit changes one paragraph, and resizing reuses shaping. Full line metadata, sampled carets/hit tests/navigation, and top/middle/bottom viewport pixels match separate cold layouts. Old snapshots remain usable. These checks compare execution paths of the same engine; the earlier size suite separately compares implementations and reference widths.

Additional fragment tests load 40 paragraphs in variable character chunks, including splits inside words, formatting ranges and a combining-accent sequence. They check bounded recomposition, final geometry/pixels versus cold loading, and old snapshot stability. They do not cover incomplete UTF-8 byte sequences or split UTF-16 surrogate pairs.

| Browser | Fragment cases | Chunks per case | Checks passed |
|---|---:|---:|---:|
| chromium | 4 | 79 | 32 |
| firefox | 4 | 79 | 32 |
| webkit | 4 | 79 | 32 |

## Assessment

Packed shaping preserves its memory advantage for larger styled documents. Incremental input produces an early rendered chunk and reuses previous shaping, but repeated full-prefix submissions still do substantial work. Later updates become expensive as the loaded prefix grows. The current API is not yet suitable for smooth large styled-document loading.

Source inspection identifies full-document grapheme validation and a scan of every formatting span for every paragraph. The latter scales with paragraph count times span count. Document placement and flat line metadata are also rebuilt on each update. Cache counters prove shaping/composition reuse; they do not imply the rest of the update is cheap. These observations identify targets, not a measured CPU attribution breakdown.

The next step is a paragraph/block update API with local formatting ranges, so append/edit operations validate and inspect only changed blocks. A viewport draw path should visit only intersecting paragraphs. Chunk work should then be scheduled against a time budget; the fixed-size chunks here are intentionally a measurement baseline. This can remain in TypeScript and does not require another serialization boundary.

## Reproduce

Build with `npm run build:owned` and serve the owned preview on port 5175. Run `node scripts/check-owned-large.mjs`, `node scripts/check-owned-fragments.mjs`, then `node scripts/report-owned-large.mjs`. Set `OWNED_URL` for another server. Raw results are `artifacts/owned-large-documents.json` and `artifacts/owned-fragment-loading.json`; summarized loading timings are `artifacts/owned-large-summary.json`.
