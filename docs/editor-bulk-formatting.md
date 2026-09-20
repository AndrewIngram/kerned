# Whole-document formatting

Batching and viewport scheduling reduced select-all bold in the Warbreaker sample to 33–56 ms, compared with 6.4–17.6 seconds before this change. The measured sample contained 7,279 blocks and 1,109,728 characters of paragraph text.

Measured on 2026-09-19 on an Apple M4 Pro, using the Vite development server at a 1,100 × 850 viewport. Each number below is the median of three fresh-page trials. Loading and selecting the document finish before the timer starts.

| Browser | Previous response, ms | Current response, ms | Current command handler, ms | Current undo response, ms | Full background layout, ms |
|---|---:|---:|---:|---:|---:|
| Chromium | 9,125.2 | 33.5 | 12.2 | 28 | 2,200.5 |
| Firefox | 17,597 | 56 | 21 | 33 | 2,508 |
| WebKit | 6,440 | 33 | 13 | 27 | 2,114 |

Response time runs from the Bold button click through two animation frames, covering the command, React update, and canvas repaint. It is not a compositor presentation timestamp. All selected text changes synchronously. The viewport and selection endpoints receive current layout immediately. Offscreen heights converge in background batches, so the scrollbar can change until that work finishes.

The largest sampled animation-frame gaps across the current trials were 16.8 ms in Chromium, 30.3 ms in Firefox, and 30 ms in WebKit. These are local measurements, not universal latency limits.

Raw results: [before](../artifacts/editor-formatting-baseline.json), [after](../artifacts/editor-formatting-benchmark.json), and [formatting reflow checks](../artifacts/editor-formatting-reflow.json).

The concurrent formatting-tools task subsequently added controls, block projection, and a title to the sample. A compatibility run on that combined state covered 7,280 blocks and 1,109,761 characters, again with three trials per browser:

| Browser | Response, ms | Command handler, ms | Undo response, ms | Full background layout, ms |
|---|---:|---:|---:|---:|
| Chromium | 41.2 | 12.4 | 25.6 | 2,284.1 |
| Firefox | 66 | 22 | 48 | 4,674 |
| WebKit | 38 | 11 | 25 | 2,132 |

These [combined-state results](../artifacts/editor-formatting-with-tools.json) also preserve the full selection and restore all original formatting with one undo. The current formatting-reflow report covers the combined state. The controls and extension commands belong to the concurrent task; this optimization changes transaction batching, scene scheduling, and the scroll-position read.

## Why it was slow

The toolbar already dispatched one transaction, but that transaction contained one `updateBlock` step per paragraph. Each step copied the root array, rebuilt the document index, compared the old and new trees, and retained a separate history patch. Whole-document formatting therefore performed quadratic work. A Chromium CPU profile attributed most time to indexing, schema resolution, and garbage collection.

`applyTransaction` now validates consecutive property updates in order and publishes them together. The document is indexed once before and once after the batch. Nested updates copy affected ancestor branches lazily, preserving the existing rules for identity, editable text, and children. Repeated updates and mixed structural or text steps retain their order. A failed step still rejects the entire transaction.

The deterministic regression check counts 800 index visits for 400 flat paragraphs, down from 160,800. Nested paragraphs show the same linear behavior. The existing `updateBlock` interface is unchanged, so other formatting commands can use this path without new command APIs.

The scene scheduler previously composed every changed paragraph synchronously. It now queues offscreen changes using the same bounded scheduler as width reflow. Old heights remain available, but obsolete glyph geometry is discarded. New formatting or undo replaces queued content, and returning to an already composed version cancels unnecessary work. Scrolling promotes current text before it is drawn.

A stress test also exposed a scroll race: a background tick could run before React received the latest scroll event. Scene construction now reads the browser's current scroll position, preventing the next tick from cancelling a jump.

## Verification

The new checks cover all-character bold, selection preservation, one-step undo, stream arrivals, nested containers, invalid updates, anchors, and mixed transaction steps. Browser cases exercise undo before layout finishes, rapid formatting changes, redo, width reversals, and scrolling into pending content.

In Chromium, Firefox, and WebKit, visible canvas screenshots match before and after background completion. An independent engine eagerly lays out every paragraph to verify final heights, placements, and retained geometry. No stale visible layouts were reported. Existing transaction, selection, container, editor-interaction, and reflow checks also pass.

With the development server running on port 5173, the checks are:

```sh
node scripts/check-editor-bulk-updates.mjs
node scripts/check-editor-formatting-reflow.mjs
BROWSERS=chromium,firefox,webkit TRIALS=3 node scripts/benchmark-editor-formatting.mjs
```

The benchmark fails if any response exceeds 250 ms. `MAX_PAINT_MS` changes that budget, `REPORT` selects an output file, and `PROFILE` captures a Chromium CPU profile. `BASELINE_DIR` optionally supplies earlier `editor/transactions.ts` and `hybrid-scene.ts` sources. Playwright injects those modules without overwriting the working files.

This change does not bound the cost of one enormous paragraph or make history safe for concurrent remote edits. Those remain separate constraints of the editor.
