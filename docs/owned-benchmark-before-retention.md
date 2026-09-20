# Baseline before document-owned retention

Recorded 2026-09-19T12:33:12.172Z on Apple M4 Pro, darwin/arm64.

This is the historical baseline for the 256-entry cache. Current code reproduces the updated benchmark, not this implementation.

Run `npm run build:owned`, serve `dist-owned`, then run `OWNED_URL=http://127.0.0.1:5175/owned-layout.html npm run benchmark:owned`. The default URL uses the dev server on port 5173. Raw samples and browser versions are in `artifacts/owned-benchmark-before-retention.json`.

Each case uses six warmups and 30 measured trials, with all six engine orders represented equally. Each trial clears the application layout cache. Edit and resize trials prime a baseline outside the timer, then insert one character in the middle paragraph or change width from 450px to 350px. Documents have unique equal-length trial prefixes to avoid reuse across trials. Text uses 20px Noto Sans with no formatting.

Cold layout means an empty application layout cache, with fonts, WASM and JIT already warm. Timings include the synchronous Engine.layout call and its current adapters. They exclude drawing, geometry queries, input handling, initialization, cache clearing, priming and disposal. These are whole-document adapter measurements; the original editor uses a separate block cache. Internal font caches are not reset.

Values below are median / p95 milliseconds. P95 is the 29th sorted sample of 30. Browser timer quantization is visible, especially for short operations. No GC is forced. This is one local run, not a cross-machine performance guarantee.

## chromium 153.0.8010.12

| Paragraphs | Operation | CanvasKit | Parley | Owned |
|---:|---|---:|---:|---:|
| 100 | cold-layout | 2.5 / 2.8 | 5.1 / 6.1 | 2.9 / 4.3 |
| 100 | edit | 2.2 / 2.6 | 4.7 / 5.0 | 0.8 / 2.1 |
| 100 | resize | 2.2 / 2.3 | 4.7 / 5.2 | 0.8 / 1.5 |
| 500 | cold-layout | 11.3 / 12.7 | 50.1 / 53.0 | 14.6 / 15.8 |
| 500 | edit | 11.3 / 13.3 | 49.5 / 53.7 | 14.8 / 16.2 |
| 500 | resize | 11.3 / 13.6 | 49.3 / 50.9 | 15.0 / 16.1 |

## firefox 155.0

| Paragraphs | Operation | CanvasKit | Parley | Owned |
|---:|---|---:|---:|---:|
| 100 | cold-layout | 3.0 / 4.0 | 6.0 / 8.0 | 3.0 / 6.0 |
| 100 | edit | 3.0 / 4.0 | 6.0 / 7.0 | 1.0 / 2.0 |
| 100 | resize | 3.0 / 4.0 | 6.0 / 7.0 | 1.0 / 2.0 |
| 500 | cold-layout | 14.0 / 19.0 | 53.5 / 63.0 | 21.0 / 23.0 |
| 500 | edit | 14.0 / 20.0 | 53.0 / 57.0 | 16.0 / 29.0 |
| 500 | resize | 14.0 / 15.0 | 55.0 / 59.0 | 20.0 / 26.0 |

## webkit 26.6

| Paragraphs | Operation | CanvasKit | Parley | Owned |
|---:|---|---:|---:|---:|
| 100 | cold-layout | 2.0 / 3.0 | 4.0 / 5.0 | 3.0 / 4.0 |
| 100 | edit | 2.0 / 3.0 | 4.0 / 5.0 | 1.0 / 2.0 |
| 100 | resize | 2.0 / 3.0 | 4.0 / 5.0 | 1.0 / 1.0 |
| 500 | cold-layout | 11.0 / 13.0 | 39.0 / 41.0 | 15.0 / 16.0 |
| 500 | edit | 11.0 / 11.0 | 39.0 / 41.0 | 11.0 / 12.0 |
| 500 | resize | 11.0 / 12.0 | 39.0 / 42.0 | 11.5 / 17.0 |

## Cache behavior

Across all measured trials and browsers, the 100-paragraph edit performs one shaping call and gets 99 cache hits. Resize performs zero shaping calls and gets 100 hits. At 500 paragraphs, cold layout, edit and resize all perform 500 shaping calls with zero cache hits. Sequential traversal of more than 256 distinct paragraphs evicts entries before they can be reused. The runner checks these counts and fails if behavior differs.

This supports document-owned retention of active paragraph layouts and viewport-aware eviction. Merely increasing the global entry limit would move the failure threshold. Even when shaping is reused, the prototype still traverses all text and rebuilds lines and editor geometry.

## Parley timing boundary

| Browser | 500-paragraph cold total median | Reported core median |
|---|---:|---:|
| chromium | 50.1 ms | 6.7 ms |
| firefox | 53.5 ms | 9.0 ms |
| webkit | 39.0 ms | 7.0 ms |

The reported Parley core ends before output extraction. The remaining work includes native glyph/line traversal, UTF-16 index conversion, JSON construction/serialization, JS parsing/schema validation and typed-array conversion. It is not a measurement of JSON cost alone. The current UTF-16 conversion scans text prefixes for line endpoints, which is a source-level scaling concern; its individual cost has not been profiled.

The owned engine eagerly constructs caret stops during layout, while the reference engines do some geometry work on demand. Feature coverage also differs: the owned prototype lacks bidi and fallback. These results compare the current adapters and cannot establish which underlying engine is intrinsically fastest.

## Decision

The owned approach benefits from paragraph shaping reuse on documents that fit its cache. It is not yet a large-document solution. Fixing document retention and incremental layout is the next owned-engine performance task. Parley deserves an adapter optimization before an engine decision: its total-call cost substantially exceeds its reported layout core.
