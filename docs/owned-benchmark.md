# Repeated owned-layout benchmarks

Recorded 2026-09-19T12:54:46.337Z on Apple M4 Pro, darwin/arm64.

Run `npm run build:owned`, serve `dist-owned`, then run `OWNED_URL=http://127.0.0.1:5175/owned-layout.html npm run benchmark:owned`. The default URL uses the dev server on port 5173. Raw samples and browser versions are in `artifacts/owned-benchmark.json`.

Each case uses six warmups and 30 measured trials, with all six engine orders represented equally. Each trial clears the application layout cache. Edit and resize trials prime a baseline outside the timer, then insert one character in the middle paragraph or change width from 450px to 350px. Documents have unique equal-length trial prefixes to avoid reuse across trials. Text uses 20px Noto Sans with no formatting.

Cold layout means an empty application layout cache, with fonts, WASM and JIT already warm. Timings include the synchronous Engine.layout call and its current adapters. They exclude drawing, geometry queries, input handling, initialization, cache clearing, priming and disposal. These are whole-document adapter measurements; the original editor uses a separate block cache. Internal font caches are not reset.

Values below are median / p95 milliseconds. P95 is the 29th sorted sample of 30. Browser timer quantization is visible, especially for short operations. No GC is forced. This is one local run, not a cross-machine performance guarantee.

## chromium 153.0.8010.12

| Paragraphs | Operation | CanvasKit | Parley | Owned |
|---:|---|---:|---:|---:|
| 100 | cold-layout | 2.5 / 3.5 | 5.1 / 5.6 | 2.8 / 4.1 |
| 100 | edit | 2.2 / 2.3 | 4.7 / 4.9 | 0.1 / 0.2 |
| 100 | resize | 2.2 / 2.3 | 4.7 / 5.4 | 0.5 / 1.5 |
| 500 | cold-layout | 11.3 / 12.8 | 50.4 / 52.4 | 13.0 / 13.3 |
| 500 | edit | 11.3 / 12.3 | 49.5 / 51.1 | 0.2 / 0.3 |
| 500 | resize | 11.5 / 12.9 | 49.6 / 50.6 | 2.9 / 4.4 |

## firefox 155.0

| Paragraphs | Operation | CanvasKit | Parley | Owned |
|---:|---|---:|---:|---:|
| 100 | cold-layout | 3.0 / 5.0 | 7.0 / 9.0 | 3.5 / 5.0 |
| 100 | edit | 3.0 / 4.0 | 6.0 / 8.0 | 0.0 / 1.0 |
| 100 | resize | 3.0 / 4.0 | 6.0 / 7.0 | 1.0 / 2.0 |
| 500 | cold-layout | 14.0 / 18.0 | 58.0 / 63.0 | 16.0 / 18.0 |
| 500 | edit | 14.0 / 17.0 | 58.0 / 63.0 | 1.0 / 1.0 |
| 500 | resize | 15.0 / 16.0 | 58.0 / 63.0 | 5.0 / 10.0 |

## webkit 26.6

| Paragraphs | Operation | CanvasKit | Parley | Owned |
|---:|---|---:|---:|---:|
| 100 | cold-layout | 2.0 / 3.0 | 5.0 / 5.0 | 2.0 / 3.0 |
| 100 | edit | 2.0 / 3.0 | 4.0 / 5.0 | 0.0 / 1.0 |
| 100 | resize | 2.0 / 3.0 | 4.0 / 5.0 | 1.0 / 1.0 |
| 500 | cold-layout | 11.0 / 12.0 | 39.0 / 42.0 | 12.0 / 14.0 |
| 500 | edit | 11.0 / 12.0 | 39.0 / 42.0 | 0.0 / 1.0 |
| 500 | resize | 11.0 / 11.0 | 39.0 / 42.0 | 3.5 / 5.0 |

## Cache behavior

Across all measured trials and browsers, editing performs one shaping call and resizing performs zero, at both 100 and 500 paragraphs. Every other paragraph is a cache hit. Cold layout shapes every paragraph. The runner checks these counts and fails if behavior differs. The immediately preceding shaping-only retention baseline is preserved in `artifacts/owned-benchmark-before-composition.json` and `docs/owned-benchmark-before-composition.md`. The earlier 256-entry cache reshaped all 500 paragraphs on edits and resizing; the baseline is preserved in `artifacts/owned-benchmark-before-retention.json` and `docs/owned-benchmark-before-retention.md`.

Each input id now retains only the shaped paragraph variants used by its latest successful layout. A replacement map is built while the previous map remains readable, then published after layout succeeds. Removed and superseded variants are released. Owners call `release(id)` when a document or block is removed, or `engine.clear()` to release all retained shaping. Existing LaidOut snapshots remain usable. Memory scales with retained document content; there is no byte budget or viewport eviction yet. The prototype still scans the supplied document text and rebuilds placement and flat line metadata for the comparison interface. Unchanged paragraph geometry and prepared render buffers are shared across snapshots. At unchanged width an edit composes one paragraph and builds one font run; resize composes all paragraphs but does no shaping. The runner verifies those counters on every measured trial.

## Parley timing boundary

| Browser | 500-paragraph cold total median | Reported core median |
|---|---:|---:|
| chromium | 50.4 ms | 6.7 ms |
| firefox | 58.0 ms | 9.0 ms |
| webkit | 39.0 ms | 6.5 ms |

The reported Parley core ends before output extraction. The remaining work includes native glyph/line traversal, UTF-16 index conversion, JSON construction/serialization, JS parsing/schema validation and typed-array conversion. It is not a measurement of JSON cost alone. The current UTF-16 conversion scans text prefixes for line endpoints, which is a source-level scaling concern; its individual cost has not been profiled.

The owned engine eagerly constructs caret stops and prepared typed render buffers during layout, while the reference engines do some geometry work on demand. Feature coverage also differs: the owned prototype lacks bidi and fallback. These results compare the current adapters and cannot establish which underlying engine is intrinsically fastest.

## Decision

Document-owned retention removes the measured 500-paragraph shaping-cache failure. Paragraph-local composition now also removes reconstruction of unchanged paragraph geometry and render buffers. Whole-document scanning, placement metadata reconstruction and painting remain. Incremental updates within a changed paragraph and viewport scheduling are not implemented. Per-paragraph drawing changes draw-call granularity; these layout-only timings do not establish painting performance. Parley still deserves an adapter optimization before an engine decision: its total-call cost substantially exceeds its reported layout core.
