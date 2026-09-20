# Baseline before retained paragraph composition

Recorded 2026-09-19T12:38:43.649Z on Apple M4 Pro, darwin/arm64.

This historical run retained shaping but rebuilt all line and caret geometry. Current code reproduces the updated implementation.

Run `npm run build:owned`, serve `dist-owned`, then run `OWNED_URL=http://127.0.0.1:5175/owned-layout.html npm run benchmark:owned`. The default URL uses the dev server on port 5173. Raw samples and browser versions are in `artifacts/owned-benchmark-before-composition.json`.

Each case uses six warmups and 30 measured trials, with all six engine orders represented equally. Each trial clears the application layout cache. Edit and resize trials prime a baseline outside the timer, then insert one character in the middle paragraph or change width from 450px to 350px. Documents have unique equal-length trial prefixes to avoid reuse across trials. Text uses 20px Noto Sans with no formatting.

Cold layout means an empty application layout cache, with fonts, WASM and JIT already warm. Timings include the synchronous Engine.layout call and its current adapters. They exclude drawing, geometry queries, input handling, initialization, cache clearing, priming and disposal. These are whole-document adapter measurements; the original editor uses a separate block cache. Internal font caches are not reset.

Values below are median / p95 milliseconds. P95 is the 29th sorted sample of 30. Browser timer quantization is visible, especially for short operations. No GC is forced. This is one local run, not a cross-machine performance guarantee.

## chromium 153.0.8010.12

| Paragraphs | Operation | CanvasKit | Parley | Owned |
|---:|---|---:|---:|---:|
| 100 | cold-layout | 2.5 / 3.2 | 5.1 / 5.2 | 3.0 / 3.9 |
| 100 | edit | 2.3 / 2.6 | 4.7 / 5.2 | 0.8 / 1.4 |
| 100 | resize | 2.2 / 2.3 | 4.7 / 5.2 | 0.8 / 1.3 |
| 500 | cold-layout | 11.4 / 13.0 | 51.3 / 54.4 | 14.8 / 15.7 |
| 500 | edit | 11.3 / 13.1 | 50.2 / 52.5 | 5.4 / 6.3 |
| 500 | resize | 11.4 / 12.1 | 50.4 / 53.9 | 5.4 / 6.4 |

## firefox 155.0

| Paragraphs | Operation | CanvasKit | Parley | Owned |
|---:|---|---:|---:|---:|
| 100 | cold-layout | 3.0 / 5.0 | 6.0 / 8.0 | 4.0 / 5.0 |
| 100 | edit | 3.0 / 3.0 | 6.0 / 7.0 | 1.0 / 2.0 |
| 100 | resize | 3.0 / 4.0 | 6.0 / 8.0 | 1.0 / 2.0 |
| 500 | cold-layout | 14.0 / 19.0 | 58.0 / 68.0 | 21.0 / 27.0 |
| 500 | edit | 14.0 / 15.0 | 57.0 / 60.0 | 6.0 / 26.0 |
| 500 | resize | 14.5 / 16.0 | 58.0 / 59.0 | 6.0 / 25.0 |

## webkit 26.6

| Paragraphs | Operation | CanvasKit | Parley | Owned |
|---:|---|---:|---:|---:|
| 100 | cold-layout | 2.0 / 3.0 | 5.0 / 5.0 | 3.0 / 4.0 |
| 100 | edit | 2.0 / 3.0 | 4.0 / 5.0 | 1.0 / 1.0 |
| 100 | resize | 2.0 / 3.0 | 4.0 / 5.0 | 1.0 / 1.0 |
| 500 | cold-layout | 11.0 / 12.0 | 40.0 / 43.0 | 11.0 / 12.0 |
| 500 | edit | 11.0 / 11.0 | 40.0 / 42.0 | 4.0 / 4.0 |
| 500 | resize | 11.0 / 11.0 | 40.0 / 42.0 | 4.0 / 5.0 |

## Cache behavior

Across all measured trials and browsers, editing performs one shaping call and resizing performs zero, at both 100 and 500 paragraphs. Every other paragraph is a cache hit. Cold layout shapes every paragraph. The runner checks these counts and fails if behavior differs. The previous 256-entry cache reshaped all 500 paragraphs on edits and resizing; the baseline is preserved in `artifacts/owned-benchmark-before-retention.json` and `docs/owned-benchmark-before-retention.md`.

Each input id now retains only the shaped paragraph variants used by its latest successful layout. A replacement map is built while the previous map remains readable, then published after layout succeeds. Removed and superseded variants are released. Owners call `release(id)` when a document or block is removed, or `engine.clear()` to release all retained shaping. Existing LaidOut snapshots remain usable. Memory scales with retained document content; there is no byte budget or viewport eviction yet. The prototype still traverses all text and rebuilds lines and editor geometry.

## Parley timing boundary

| Browser | 500-paragraph cold total median | Reported core median |
|---|---:|---:|
| chromium | 51.3 ms | 6.7 ms |
| firefox | 58.0 ms | 9.0 ms |
| webkit | 40.0 ms | 7.0 ms |

The reported Parley core ends before output extraction. The remaining work includes native glyph/line traversal, UTF-16 index conversion, JSON construction/serialization, JS parsing/schema validation and typed-array conversion. It is not a measurement of JSON cost alone. The current UTF-16 conversion scans text prefixes for line endpoints, which is a source-level scaling concern; its individual cost has not been profiled.

The owned engine eagerly constructs caret stops during layout, while the reference engines do some geometry work on demand. Feature coverage also differs: the owned prototype lacks bidi and fallback. These results compare the current adapters and cannot establish which underlying engine is intrinsically fastest.

## Decision

Document-owned retention removes the measured 500-paragraph shaping-cache failure. It does not eliminate whole-document traversal, geometry reconstruction or painting. Incremental line layout and viewport scheduling remain necessary for larger documents. Parley still deserves an adapter optimization before an engine decision: its total-call cost substantially exceeds its reported layout core.
