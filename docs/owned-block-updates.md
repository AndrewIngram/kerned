# Block updates

Measured 2026-09-19T14:07:11.322Z, Apple M4 Pro.

## Contract

A block document is an owned session. Each block is one Latin/LTR paragraph with local formatting ranges and no newline. A splice replaces a contiguous range of block positions. The session copies input spans, validates only the inserted/replaced blocks, prepares their layouts, then publishes the update atomically. Failed validation, native shaping or configuration leaves the previous snapshot and settings usable. Empty sessions render one implicit blank paragraph.

```ts
const document = owned.createBlockDocument({ width: 480, size: 20 });
let snapshot = document.splice(0, 0, firstChunk);
snapshot = document.splice(document.blockCount, 0, nextChunk);
snapshot = document.splice(12, 1, [editedParagraph]);
snapshot = document.configure({ width: 320, size: 20 });
snapshot = document.snapshot(); // read the published snapshot without rebuilding
document.release(); // published snapshots remain usable
```

A block is `{ text, spans }`; each span has local `start`, `end`, `bold` and `italic`. Ranges must be nonempty and end at grapheme boundaries. Overlaps are supported with the existing combined-style semantics. Width changes recompose all blocks without reshaping or revalidating them. Font-size changes reshape all blocks without repeating text validation. `release()` is idempotent; later reads or updates on that session throw. Engine `clear()` closes all block sessions as well as legacy document caches.

The block session module owns local validation, copied inputs, update order, rollback and lifetime. The engine owns the shared paragraph preparation and snapshot rendering. The whole-document API remains the comparison adapter and current UI path; it does not internally convert to block updates. The default renderer/storage selection is unchanged.

## Design choice and remaining costs

A stateless `layoutBlocks(allBlocks)` API would remove global formatting offsets but still require rescanning all inputs for changes. A stateful `splice(index, deleteCount, insertedBlocks)` API lets callers identify the changed range directly. The latter was chosen because chunk delivery and paragraph edits already identify that range. Positions refer to the current document; this is synchronous local editing, not a concurrent operation protocol with stable IDs or revisions.

This version still copies arrays of block references and rebuilds placement and flat line metadata after each splice. A one-block edit is therefore not O(1) overall. Drawing still visits all paragraphs. It does not implement viewport culling, workers, transport or a frame-budget scheduler. No new serialization boundary was added. Local validation removes full-document grapheme checks and repeated global span scans from the block path.

## Loading measurements

Both arms use direct packed shaping. Each browser/case uses a fresh page, a full-document warmup and three measured cold-cache/streamed trials. Whole and block paths run sequentially with order reversed for styled fixtures. This small sample is exploratory. Styled fixtures have two spans per paragraph; chunks contain 100 paragraphs for a 2,000-paragraph document and 500 for 10,000. Median milliseconds are shown; worst update is the maximum across all chunk trials.

Cold measures layout. First submission includes locally simulated JSON parsing, assembly where required, layout and draw/flush to a fixed 500×640 software canvas. It does not measure network latency or actual browser presentation. Total work excludes setTimeout yields between chunks. The block path consumes incoming block ranges without reconstructing full text/global spans.

| Browser | Paragraphs | Styled | API | Cold ms | First submission ms | Total stream work ms | Last update ms | Worst update ms |
|---|---:|---|---|---:|---:|---:|---:|---:|
| chromium | 2000 | no | whole | 55.3 | 4.1 | 117.8 | 7.7 | 7.9 |
| chromium | 2000 | no | blocks | 53.5 | 3.5 | 91.0 | 5.3 | 7.3 |
| chromium | 2000 | yes | blocks | 112.1 | 6.6 | 156.8 | 9.0 | 9.8 |
| chromium | 2000 | yes | whole | 125.4 | 6.8 | 407.2 | 35.4 | 59.5 |
| chromium | 10000 | no | whole | 295.6 | 15.3 | 506.2 | 35.4 | 35.4 |
| chromium | 10000 | no | blocks | 281.8 | 15.1 | 367.2 | 21.2 | 23.1 |
| chromium | 10000 | yes | blocks | 579.1 | 29.3 | 722.2 | 42.3 | 69.6 |
| chromium | 10000 | yes | whole | 1488.9 | 32.3 | 4478.9 | 420.1 | 950.9 |
| firefox | 2000 | no | whole | 70.0 | 4.0 | 151.0 | 10.0 | 13.0 |
| firefox | 2000 | no | blocks | 66.0 | 5.0 | 122.0 | 7.0 | 11.0 |
| firefox | 2000 | yes | blocks | 132.0 | 8.0 | 200.0 | 11.0 | 18.0 |
| firefox | 2000 | yes | whole | 171.0 | 8.0 | 620.0 | 66.0 | 72.0 |
| firefox | 10000 | no | whole | 341.0 | 20.0 | 621.0 | 43.0 | 54.0 |
| firefox | 10000 | no | blocks | 329.0 | 17.0 | 452.0 | 28.0 | 41.0 |
| firefox | 10000 | yes | blocks | 657.0 | 33.0 | 852.0 | 51.0 | 55.0 |
| firefox | 10000 | yes | whole | 1538.0 | 40.0 | 7904.0 | 968.0 | 991.0 |
| webkit | 2000 | no | whole | 43.0 | 3.0 | 86.0 | 6.0 | 6.0 |
| webkit | 2000 | no | blocks | 43.0 | 3.0 | 76.0 | 4.0 | 6.0 |
| webkit | 2000 | yes | blocks | 94.0 | 6.0 | 137.0 | 8.0 | 9.0 |
| webkit | 2000 | yes | whole | 106.0 | 6.0 | 377.0 | 35.0 | 41.0 |
| webkit | 10000 | no | whole | 215.0 | 13.0 | 376.0 | 25.0 | 26.0 |
| webkit | 10000 | no | blocks | 220.0 | 12.0 | 318.0 | 20.0 | 20.0 |
| webkit | 10000 | yes | blocks | 478.0 | 26.0 | 640.0 | 38.0 | 40.0 |
| webkit | 10000 | yes | whole | 1174.0 | 28.0 | 3406.0 | 453.0 | 454.0 |

## Update diagnostics

Single observations after the stream trials, not timing distributions. `snapshot()` is a direct read in the block path. Edit changes one middle paragraph; resize changes 480px to 310px.

| Browser | Paragraphs | Styled | API | Unchanged/read ms | Edit ms | Resize ms |
|---|---:|---|---|---:|---:|---:|
| chromium | 2000 | no | whole | 3.1 | 3.3 | 15.2 |
| chromium | 2000 | no | blocks | 0.0 | 1.0 | 10.6 |
| chromium | 2000 | yes | blocks | 0.0 | 1.0 | 12.2 |
| chromium | 2000 | yes | whole | 32.7 | 29.7 | 71.6 |
| chromium | 10000 | no | whole | 16.1 | 16.6 | 93.8 |
| chromium | 10000 | no | blocks | 0.1 | 3.9 | 76.4 |
| chromium | 10000 | yes | blocks | 0.0 | 3.7 | 90.3 |
| chromium | 10000 | yes | whole | 392.7 | 387.4 | 1053.9 |
| firefox | 2000 | no | whole | 3.0 | 4.0 | 20.0 |
| firefox | 2000 | no | blocks | 0.0 | 1.0 | 17.0 |
| firefox | 2000 | yes | blocks | 0.0 | 1.0 | 18.0 |
| firefox | 2000 | yes | whole | 51.0 | 52.0 | 68.0 |
| firefox | 10000 | no | whole | 18.0 | 23.0 | 100.0 |
| firefox | 10000 | no | blocks | 0.0 | 3.0 | 100.0 |
| firefox | 10000 | yes | blocks | 0.0 | 3.0 | 84.0 |
| firefox | 10000 | yes | whole | 926.0 | 916.0 | 1020.0 |
| webkit | 2000 | no | whole | 2.0 | 1.0 | 8.0 |
| webkit | 2000 | no | blocks | 0.0 | 1.0 | 9.0 |
| webkit | 2000 | yes | blocks | 0.0 | 1.0 | 7.0 |
| webkit | 2000 | yes | whole | 26.0 | 26.0 | 34.0 |
| webkit | 10000 | no | whole | 9.0 | 8.0 | 41.0 |
| webkit | 10000 | no | blocks | 0.0 | 3.0 | 36.0 |
| webkit | 10000 | yes | blocks | 0.0 | 4.0 | 37.0 |
| webkit | 10000 | yes | whole | 351.0 | 351.0 | 387.0 |

## Memory

Chromium post-GC samples after streaming, relative to a warmed/released baseline. JS used heap plus backing stores, decimal MB; not total browser or peak memory. Backing stores include external strings as well as ArrayBuffers. Small release residuals are reported rather than treated as retained documents.

| Paragraphs | Styled | API | Loaded MB | Released MB | Released backing bytes |
|---:|---|---|---:|---:|---:|
| 2000 | no | whole | 30.04 | 0.18 | 0 |
| 2000 | no | blocks | 30.08 | 0.18 | 2915 |
| 2000 | yes | blocks | 30.85 | 0.20 | 0 |
| 2000 | yes | whole | 31.03 | 0.18 | 0 |
| 10000 | no | whole | 150.06 | 0.18 | 0 |
| 10000 | no | blocks | 150.13 | 0.18 | 0 |
| 10000 | yes | blocks | 153.82 | 0.19 | 0 |
| 10000 | yes | whole | 154.97 | 0.17 | 0 |

## Verification

Large-document tests compare streamed, edited and resized snapshots with cold whole-document layouts, including complete line metadata, sampled caret/hit/navigation results and top/middle/bottom pixels. Counters verify that block appends validate only incoming blocks, an edit validates one block, and resize validates none. Both APIs preserve old snapshots.

| Browser | Focused API assertions | Failed check groups |
|---|---:|---:|
| chromium | 108784 | 0 |
| firefox | 108784 | 0 |
| webkit | 108784 | 0 |

Focused checks cover widths 1/120/333.3/2400 and sizes 8/20/72, empty and blank paragraphs, overlapping formatting, insert/replace/delete, width/font-size changes, invalid ranges, grapheme-splitting formatting, failed multi-block updates, native missing-glyph failure, caller mutation, independent sessions, engine clear, repeated release and snapshot lifetime.

## Assessment

Block-local updates remove most of the styled-document processing overhead in these tests, while retaining similar memory use. Initial chunk work still includes shaping its contents, and 500-paragraph styled chunks exceed a 16ms frame budget. Placement rebuilding and whole-document drawing remain measurable. The next experiment should cull drawing to visible paragraphs and adapt chunk sizes to a time budget; a persistent placement index can follow if profiling shows the remaining document-wide work dominates.

## Reproduce

Build with `npm run build:owned`, serve the owned production preview on port 5175, then run `node scripts/check-owned-blocks.mjs`, `node scripts/check-owned-blocks-large.mjs`, and `node scripts/report-owned-blocks.mjs`. `OWNED_URL` selects another server. Raw results: `artifacts/owned-block-checks.json`, `artifacts/owned-blocks-large.json`. Loading/update summary: `artifacts/owned-block-summary.json`.
