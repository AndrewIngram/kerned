# Retained memory and caret capacity

Recorded 2026-09-19T13:39:03.518Z, Apple M4 Pro, Chromium 153.0.8010.12.

## Method and scope

Three fresh browser pages per variant and document size, alternating variant order. Fonts, code and the native allocator are warmed with the same document before recording an empty-document baseline. Each stage unwinds the evaluation stack and requests garbage collection twice, then reads Chromium Runtime.getHeapUsage. These forced-GC measurements inspect retention, not normal GC timing or peak allocation.

JavaScript usedSize and backingStorageSize are reported separately. Backing storage includes ArrayBuffer storage and external strings. Their sum is a tracked-memory comparison, not renderer-process RSS or total browser memory; embedder/native/GPU allocations are not fully represented. The baseline already includes the comparison page, font data, WASM modules and native allocator high-water memory. Raw metrics, including embedder heap and native shaping-module linear-memory size, are preserved in the artifact.

Exact caret capacity is measured from the paragraph buffer and live counts. Glyph buffers are counted separately. Cache telemetry covers the current retained document only; saved old snapshots are deliberately measured by the browser after cache release. Object caret storage is captured by JS heap measurements, not guessed from object counts.

## Loaded document

Median deltas from each page’s warmed baseline, in decimal MB.

| Paragraphs | Storage | JS heap | Backing stores | Sum |
|---:|---|---:|---:|---:|
| 500 | objects | 14.57 | 0.32 | 14.89 |
| 500 | carets | 11.51 | 1.30 | 12.82 |
| 2000 | objects | 58.62 | 1.29 | 59.91 |
| 2000 | carets | 46.32 | 5.27 | 51.58 |

## Capacity

| Paragraphs | Width | Reserved caret MB | Live payload MB | Unused |
|---:|---:|---:|---:|---:|
| 500 | 350px | 0.98 | 0.46 | 53.3% |
| 500 | 1200px | 0.98 | 0.45 | 54.2% |
| 500 | 1px | 0.98 | 0.98 | 0.0% |
| 2000 | 350px | 3.98 | 1.86 | 53.4% |
| 2000 | 1200px | 3.98 | 1.82 | 54.2% |
| 2000 | 1px | 3.98 | 3.98 | 0.0% |

The current capacity allows one soft line per shaping cluster. At 1px width that bound is used; normal-width documents reserve spare caret slots and line boundaries. Spare capacity is retained intentionally, not a leak. An exact-sizing design needs a line-count pass or compaction/copy after composition; its latency and transient memory must be measured before adopting it.

## Lifecycle

Median JS-plus-backing deltas from baseline, in MB. Pin-and-resize retains an old snapshot at 350px and the new snapshot at 240px. Fifty edits replace the first paragraph without retaining every intermediate snapshot. Release-cache removes the retained document while those two snapshots remain alive. Drop-snapshots then removes both references.

| Paragraphs | Storage | Loaded | Two snapshots | After 50 edits | Cache released | Snapshots dropped | After 10 release cycles |
|---:|---|---:|---:|---:|---:|---:|---:|
| 500 | objects | 14.89 | 20.05 | 20.08 | 10.16 | 0.05 | 0.06 |
| 500 | carets | 12.82 | 15.80 | 15.82 | 5.91 | 0.06 | 0.07 |
| 2000 | objects | 59.91 | 80.62 | 80.70 | 40.63 | 0.05 | 0.06 |
| 2000 | carets | 51.58 | 63.58 | 63.60 | 23.54 | 0.05 | 0.05 |

Backing stores return to baseline after cache and snapshot references are dropped in these trials. Small residual JS heap deltas remain, so this is evidence of correct release in the tested lifecycle, not proof against every possible leak. Native WASM memory may retain allocator capacity; the warmed baseline and per-stage linear-memory measurement make that separate from retained document data.

## Assessment

Packed carets save roughly 14% of tracked retained document memory in these fixtures. That is materially smaller than the earlier ~46% reduction in sampled allocation volume: the two experiments measure different things. Backing-store usage rises, but the reduction in JS objects more than compensates.

Normal-width spare caret capacity is about 53%; for 2,000 paragraphs, approximately 2.12 MB is reserved but unused. Eliminating all of it would save only about another 4% of this fixture’s tracked total, before counting any implementation overhead. It is worth testing, but is not the largest remaining memory cost.

Cache release with two snapshots still pinned frees about 40 MB of JS heap in the 2,000-paragraph packed variant. The snapshots continue to own composed geometry, so the released memory points mainly to retained shaping data and cache bookkeeping. The source still stores glyph/cluster objects and their small arrays. A full replacement of that object graph is a more substantial memory candidate than merely adding another packed view.

The memory case for packed carets is supported on this Chromium/M4 Pro configuration. The existing direct-caret-lookup tradeoff and occasional p95 regressions remain relevant; the default is unchanged by this measurement task.

## Reproduce

Build the owned page and serve the production preview on port 5175. Run `npm run memory:owned`, then `node scripts/report-owned-memory.mjs`. Set `OWNED_URL` for another server. Results are in `artifacts/owned-retained-memory.json`; summarized medians are in `artifacts/owned-memory-summary.json`.
