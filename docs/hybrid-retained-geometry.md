# Retained geometry

The hybrid editor now keeps caret and glyph-position geometry near the viewport and for pinned interactions. Offscreen paragraphs retain their measured height, width and shaping data. Revisiting them recomposes geometry in TypeScript without another HarfRust call or serialization boundary.

Packed caret buffers also shrink to their actual caret and line counts before a snapshot is published. Previously they retained capacity for the worst case of one line per cluster.

## Memory

Chromium, 1100 × 950 viewport, mixed styled documents. Each value is the increase from the same page paused at 32 blocks, after two forced garbage collections. Decimal MB, one memory trial per condition. Heap and backing storage are separate CDP categories, not total browser process memory.

| Blocks | Policy | Added JS heap, MB | Added backing storage, MB |
|---|---|---:|---:|
| 2,000 | Compact carets, retain all geometry | 13.8 | 17.6 |
| 2,000 | Compact carets, viewport geometry | 9.1 | 13.1 |
| 10,000 | Compact carets, retain all geometry | 67.7 | 90.0 |
| 10,000 | Compact carets, viewport geometry | 43.6 | 66.5 |

The earlier 10,000-block measurement was 67.0 MB heap and 108.7 MB backing storage. Compared with that historical run, the new default reduces these categories by about 35% and 39%. The same-build comparison above isolates geometry eviction from caret compaction.

For full retention at 10,000 blocks, compaction reduces accounted caret storage from 34.0 MB to 15.1 MB, eliminating 18.9 MB of unused capacity. With viewport retention, the initial scene holds about 0.074 MB of caret buffers and 0.055 MB of glyph buffers across 47 composed paragraphs including the shared mention label. Shapes remain resident for all 9,000 paragraph variants and account for 63.8 MB of packed shaping buffers. Buffer categories can share backing storage and must not be added as independent process-memory measurements.

The cache preserves existing geometry within 48 blocks on either side of the viewport and overscan, plus pinned interactions. It composes missing geometry only when needed. This keeps revisited nearby text inexpensive without precomposing the whole neighbourhood. Tests assert fewer than 128 resident paragraphs for these fixtures; 128 is not a universal hard limit for arbitrarily small blocks or arbitrarily many pins.

After three start/middle/end scroll cycles and two width changes, the 10,000-block default measured 1.73 MB more heap and 0.26 MB more backing storage than immediately after loading. Geometry remained bounded. This is a finite cycling check, not proof that every long-running workload is leak-free. React can retain previous snapshots; engine accounting describes its current cache, while CDP measures reachable browser allocations.

## Cost and correctness

In the Chromium memory workload, scene work on revisiting evicted regions took 0.7–2.0 ms at 10,000 blocks. These are diagnostic samples, not an end-to-end scroll latency benchmark. Resident scrolls reuse the scene; hydration currently scans placement metadata when entering a nonresident region.

A separate timing run used three trials per browser at 10,000 blocks. Median first repaint after resizing from 1100 to 700 pixels remained 18.2 ms in Chromium, 14 ms in Firefox and 17 ms in WebKit. Median completion was 1.20, 1.30 and 1.20 seconds respectively. Forced GC was confined to the memory workload.

Validation covers:

- Packed caret geometry, hit testing, selection and movement across fonts, widths and sizes: 158,700 assertions per browser in Chromium, Firefox and WebKit.
- Published snapshots remaining usable after the engine releases geometry; recomposition reuses shaping and matches the original snapshot.
- React extensions and atomic inline elements, including inline boxes and caret positions after geometry eviction.
- Large mixed documents, streaming while editing, undo, focus pinning, measured images and widgets, zoom, rapid width changes and stable scroll anchors.
- Fresh-engine references for every paragraph's measured height and width, and full query geometry for resident paragraphs. Reference checks after visiting the middle, end and start exercise rehydrated regions.
- Byte-identical Chromium document screenshots under full and viewport retention at the start, middle and end.
- Zero missing or stale visible layouts and no additional shaping calls during scroll cycles.

## Reproduce

Build with `npm run build` and serve the production preview on port 5176. The default `/hybrid-editor.html?stream=10000` uses viewport retention. Add `retention=all` for the compacted full-retention comparison.

Run `npm run memory:hybrid` for memory and rehydration checks. Run `npm run check:hybrid`, `npm run check:hybrid-large`, and `npm run check:hybrid-reflow` for interaction coverage. Run `node scripts/check-hybrid-retention-pixels.mjs` to compare rendered document pixels across policies.

For the timing report without replacing the earlier baseline artifact:

```sh
REFLOW_REPORT=artifacts/hybrid-retention-reflow.json npm run benchmark:hybrid-reflow
```

Raw results are in `artifacts/hybrid-retention.json`, `artifacts/hybrid-retention-reflow.json`, and `artifacts/hybrid-retention-pixels.json`.

Total memory still grows with the document because text, shaping, metadata and model state remain resident. This change bounds detailed geometry, not the entire document. Reducing shaping retention or paging content requires its own measured policy so that memory savings do not introduce expensive shaping during scrolling.
