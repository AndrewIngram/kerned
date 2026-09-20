# Composition CPU and allocation profiling

Recorded 2026-09-19T13:12:37.792Z on Apple M4 Pro, Chromium 153.0.8010.12.

## Method

Run the Vite dev server on port 5173, then `npm run profile:owned`. Readable generated source is captured alongside each profile so line attribution can be audited. Workloads use 500 distinct paragraphs, 12px text, and alternating widths of 240px and 175.2px. Cold layout runs 100 iterations, resize 300, and one-paragraph edits 2,000. Setup and warmup occur before capture. The edit harness constructs input text inside the captured interval; it is identified separately.

CPU sampling requests a 100µs interval. Actual sampling cadence is browser-dependent. Allocation sampling uses a 16KiB average interval and includes objects collected by both minor and major GC. CPU and allocation captures are separate. These runs include profiler overhead and are not latency benchmarks. Allocation estimates describe cumulative sampled allocation volume, not retained memory, RSS, or a complete account of ArrayBuffer backing stores and WASM memory.

Raw `.cpuprofile`, `.heapprofile` and generated-source files are under `artifacts/owned-profiles/`; the compact result is `artifacts/owned-profiling.json`.

## CPU samples by stage

Paragraph stages below use source-line tick attribution, not inserted timers. Generated code/inlining can blur attribution, and source ticks are diagnostic rather than precise stage durations. Percentages use all self CPU samples, including runtime and harness work. Unlisted samples include shaping, grapheme segmentation, document traversal, placement, packing preparation and runtime work.

| Workload | Wrap | Glyph positioning | Caret creation | Caret index | Render buffers | GC |
|---|---:|---:|---:|---:|---:|---:|
| cold-objects | 0.5% | 1.6% | 2.3% | 3.1% | 2.3% | 8.5% |
| cold-packed | 0.4% | 1.6% | 1.6% | 2.8% | 1.2% | 8.2% |
| resize-objects | 3.2% | 9.0% | 14.5% | 17.4% | 12.1% | 16.1% |
| resize-packed | 2.8% | 12.6% | 14.5% | 20.0% | 10.8% | 13.5% |
| edit-objects | 0.0% | 0.2% | 0.6% | 0.8% | 0.3% | 3.0% |
| edit-packed | 0.1% | 0.3% | 0.2% | 0.4% | 0.2% | 2.8% |

## Allocation estimates

| Workload | Estimated allocated MB per operation |
|---|---:|
| cold-objects | 22.35 |
| cold-packed | 21.51 |
| resize-objects | 9.15 |
| resize-packed | 7.81 |
| edit-objects | 0.46 |
| edit-packed | 0.46 |

During resize, the largest attributed allocation sites are `composeParagraph` and `Map.set`. Sampling/inlining prevents attributing every byte to an individual object constructor. The source creates one stop object for each caret position and another pair object for each unique offset in the caret map. Packing glyph input does not remove either structure.

Cold layout also spends substantial samples in `boundaries`/grapheme segmentation and HarfRust. Packing itself becomes additional work there. During retained edits, very little time remains in paragraph composition: document traversal, cache keys and rebuilding placement/flat line metadata dominate the owned JavaScript work.

## Assessment

The next numeric-data experiment should target caret storage and indexing rather than further specializing glyph arithmetic. Ordered offset/x arrays plus per-line ranges could replace stop objects and offset-pair maps. This remains a hypothesis to test: binary-search lookup, soft-wrap affinities, snapshot lifetimes and memory must be checked against the current implementation.

Keep the current default until a packed-caret prototype demonstrates consistent benefits. For edits, block-level input and incremental document placement are more promising than a faster glyph loop. None of these steps requires a new serialization or WebAssembly boundary.

## Unprofiled repeat

A separate production-build run in fresh browser sessions repeats six warmups and 30 measured trials per case. CPU/allocation profilers are not attached. Raw results are in `artifacts/owned-storage-repeat.json`. The full result includes cold, edit and resize workloads; selected 500-paragraph resize medians/p95 follow.

| Browser | Font size | Objects median / p95 | Packed median / p95 |
|---|---:|---:|---:|
| chromium | 12px | 3.80 / 4.70 ms | 2.50 / 4.30 ms |
| chromium | 37.5px | 3.85 / 4.60 ms | 2.40 / 4.30 ms |
| firefox | 12px | 5.00 / 11.00 ms | 4.00 / 10.00 ms |
| firefox | 37.5px | 5.00 / 11.00 ms | 4.00 / 9.00 ms |
| webkit | 12px | 3.00 / 3.00 ms | 2.00 / 3.00 ms |
| webkit | 37.5px | 3.00 / 3.00 ms | 2.00 / 3.00 ms |

The repeat favors packed placement for these 500-paragraph resize cases, but the earlier Chromium small-text case had the opposite ranking. Cold setup is often slower and retained edits are largely unchanged. One configuration/run must not decide the default. Timers quantize short operations, especially in Firefox and WebKit.
