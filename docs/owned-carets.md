# Packed caret experiment

The opt-in `createOwnedEngine(kit, "carets")` variant replaces caret stop objects, row arrays of stop references and the offset-to-affinity map with a single paragraph-owned ArrayBuffer. It leaves glyph placement unchanged, isolating this experiment from the earlier packed-glyph path. The default is still the object implementation.

## Representation and tradeoffs

Float64 x positions preserve arithmetic precision. Uint32 character offsets and row starts identify stops and lines; one byte per stop stores affinity. Repeated offsets at soft wraps select the first stop for upstream affinity and the last for downstream. Offset and x lookup use binary search. Horizontal movement increments the located stop ordinal, avoiding the object path’s linear indexOf scan.

The buffer reserves enough capacity for one line per shaping cluster: 13 bytes per reserved caret plus 4 bytes per reserved line boundary. Normal paragraphs leave spare capacity. The buffer is immutable after publication and remains paragraph-local, so placement changes and existing snapshots can share it. This is ordinary scalar JavaScript with typed arrays; it adds no runtime or serialization boundary.

Binary search replaces average constant-time map lookup, which can slow direct caret queries. This is an explicit tradeoff rather than a claim that every operation is faster.

## Correctness

| Browser | Layout cases | Assertions | Pixel comparisons | Failures |
|---|---:|---:|---:|---:|
| chromium | 258 | 158696 | 12 | 0 |
| firefox | 258 | 158696 | 12 | 0 |
| webkit | 258 | 158696 | 12 | 0 |

Coverage includes the prior size/width/document matrix, both caret affinities for all navigation directions, hit-test ties, reversed selections, empty and wrapped lines, edited-versus-cold equivalence, snapshot lifetimes, failed-layout recovery and explicit release. Query benchmarks also verify equal accumulated results for both implementations. These checks remain within the prototype’s Latin/LTR scope.

## Layout timings

Six warmups and 30 measured trials per workload; alternating variant order; independently primed baselines. Median / p95 in milliseconds. Drawing and startup are excluded. Zero denotes timer quantization, not free work. These are paired measurements from one local run.

### chromium

| Workload | Operation | Objects | Packed carets |
|---|---|---:|---:|
| 100 paragraphs | cold | 2.40 / 3.50 | 2.20 / 3.30 |
| 100 paragraphs | edit | 0.00 / 0.10 | 0.10 / 0.20 |
| 100 paragraphs | resize | 0.50 / 0.70 | 0.40 / 0.80 |
| 500 small-text paragraphs | cold | 11.40 / 19.80 | 10.90 / 16.60 |
| 500 small-text paragraphs | edit | 0.20 / 0.50 | 0.20 / 0.30 |
| 500 small-text paragraphs | resize | 2.40 / 4.10 | 2.10 / 3.70 |
| 500 large-text paragraphs | cold | 11.40 / 19.80 | 10.90 / 16.70 |
| 500 large-text paragraphs | edit | 0.20 / 0.30 | 0.20 / 1.70 |
| 500 large-text paragraphs | resize | 2.30 / 4.10 | 2.20 / 3.30 |
| one long paragraph | cold | 2.35 / 4.40 | 2.10 / 4.10 |
| one long paragraph | edit | 2.00 / 3.20 | 1.80 / 1.90 |
| one long paragraph | resize | 0.70 / 2.10 | 0.40 / 0.50 |

### firefox

| Workload | Operation | Objects | Packed carets |
|---|---|---:|---:|
| 100 paragraphs | cold | 3.00 / 5.00 | 3.00 / 5.00 |
| 100 paragraphs | edit | 0.00 / 1.00 | 0.00 / 1.00 |
| 100 paragraphs | resize | 1.00 / 2.00 | 1.00 / 2.00 |
| 500 small-text paragraphs | cold | 15.00 / 16.00 | 11.00 / 12.00 |
| 500 small-text paragraphs | edit | 0.00 / 1.00 | 0.00 / 1.00 |
| 500 small-text paragraphs | resize | 4.00 / 5.00 | 4.00 / 5.00 |
| 500 large-text paragraphs | cold | 15.00 / 16.00 | 11.00 / 12.00 |
| 500 large-text paragraphs | edit | 0.00 / 1.00 | 0.00 / 1.00 |
| 500 large-text paragraphs | resize | 4.00 / 5.00 | 4.00 / 5.00 |
| one long paragraph | cold | 3.00 / 5.00 | 3.00 / 7.00 |
| one long paragraph | edit | 2.50 / 3.00 | 2.50 / 3.00 |
| one long paragraph | resize | 1.00 / 2.00 | 1.00 / 2.00 |

### webkit

| Workload | Operation | Objects | Packed carets |
|---|---|---:|---:|
| 100 paragraphs | cold | 2.00 / 2.00 | 2.00 / 2.00 |
| 100 paragraphs | edit | 0.00 / 0.00 | 0.00 / 0.00 |
| 100 paragraphs | resize | 1.00 / 1.00 | 0.00 / 1.00 |
| 500 small-text paragraphs | cold | 9.00 / 11.00 | 8.00 / 9.00 |
| 500 small-text paragraphs | edit | 0.00 / 1.00 | 0.00 / 1.00 |
| 500 small-text paragraphs | resize | 2.00 / 3.00 | 2.00 / 2.00 |
| 500 large-text paragraphs | cold | 9.00 / 10.00 | 9.00 / 10.00 |
| 500 large-text paragraphs | edit | 0.00 / 1.00 | 0.00 / 1.00 |
| 500 large-text paragraphs | resize | 3.00 / 3.00 | 2.00 / 2.00 |
| one long paragraph | cold | 2.00 / 3.00 | 2.00 / 2.00 |
| one long paragraph | edit | 2.00 / 2.00 | 2.00 / 2.00 |
| one long paragraph | resize | 1.00 / 1.00 | 0.00 / 1.00 |

## Allocations

Separate Chromium resize profiles sample every 16KiB on average and include allocations collected by minor and major GC. Both runs perform 300 full resizes of 500 paragraphs. The following figures are estimated cumulative sampled allocation volume per resize, not retained memory or RSS. ArrayBuffer backing stores and WASM memory are not completely represented; profiler elapsed times are not latency benchmarks.

| Variant | Estimated allocated MB / resize |
|---|---:|
| resize-objects | 9.19 |
| resize-carets | 4.97 |

## Interaction timings

Median batch time in milliseconds for **5,000 queries**, with 20 measured batches and four warmups, alternating order. The long paragraph contains 700 repeats of a phrase; the document fixture has 500 paragraphs. These tests query existing layouts and exclude layout and drawing. Each object/packed pair returns the same checksum.

| Browser | Fixture | Query | Objects | Packed carets |
|---|---|---|---:|---:|
| chromium | 500 paragraphs | caret | 0.60 | 0.80 |
| chromium | 500 paragraphs | hit | 0.80 | 0.70 |
| chromium | 500 paragraphs | move | 0.70 | 0.70 |
| chromium | 500 paragraphs | selection | 2.40 | 2.40 |
| chromium | long paragraph | caret | 0.20 | 0.40 |
| chromium | long paragraph | hit | 0.40 | 0.20 |
| chromium | long paragraph | move | 4.10 | 0.50 |
| chromium | long paragraph | selection | 6.30 | 5.90 |
| firefox | 500 paragraphs | caret | 1.00 | 1.00 |
| firefox | 500 paragraphs | hit | 1.00 | 1.00 |
| firefox | 500 paragraphs | move | 1.00 | 1.00 |
| firefox | 500 paragraphs | selection | 4.00 | 3.00 |
| firefox | long paragraph | caret | 0.50 | 1.00 |
| firefox | long paragraph | hit | 1.00 | 0.00 |
| firefox | long paragraph | move | 14.00 | 1.00 |
| firefox | long paragraph | selection | 9.00 | 8.00 |
| webkit | 500 paragraphs | caret | 1.00 | 1.00 |
| webkit | 500 paragraphs | hit | 1.00 | 0.50 |
| webkit | 500 paragraphs | move | 1.00 | 1.00 |
| webkit | 500 paragraphs | selection | 2.50 | 2.00 |
| webkit | long paragraph | caret | 0.00 | 0.00 |
| webkit | long paragraph | hit | 0.50 | 0.00 |
| webkit | long paragraph | move | 6.00 | 0.00 |
| webkit | long paragraph | selection | 7.00 | 5.00 |

## Assessment

This is a stronger candidate than packing glyph arithmetic alone. It reduces sampled allocation volume substantially and improves several cold-layout/reflow cases. Retained edit times remain largely unchanged. Direct caret queries can be slower, while horizontal navigation in long paragraphs improves substantially. Some layout p95 values regress, so this is not a universal latency win.

Keep the option available for further comparison. Before switching the default, check retained memory including buffer backing stores and repeat critical workloads across devices. The current overallocated capacity, rather than a serialization boundary, is an obvious next memory question. Block-level updates remain the next way to reduce document traversal during edits.

## Reproduce

Build and serve the owned production page on port 5175. Run `OWNED_VARIANT=carets npm run validate:owned` for paired layout timings and `npm run check:carets` for the expanded validation and query benchmarks. With the dev server on port 5173, run `OWNED_VARIANT=carets OWNED_PROFILE_SCENARIO=resize npm run profile:owned` for allocation/CPU profiles. Regenerate this report with `node scripts/report-owned-carets.mjs`.

Artifacts: `owned-caret-validation.json`, `owned-caret-checks.json`, `owned-caret-profiling.json`; raw profiles are under `artifacts/owned-caret-profiles/`.

## Retained-memory follow-up

A separate post-GC measurement includes ArrayBuffer backing stores and snapshot lifetimes. It finds about 14% lower tracked retained document memory with packed carets, and roughly 53% unused caret-buffer capacity at ordinary widths. See [measurements and lifecycle checks](owned-retained-memory.md).
