# Viewport drawing and adaptive loading

Measured 2026-09-19T14:27:06.475Z, Apple M4 Pro.

The owned snapshot now exposes `drawViewport(canvas, x, y, top, bottom)`. The interval is in document CSS-pixel coordinates before translation or canvas scaling. It binary-searches paragraph placement and submits only intersecting paragraphs, with conservative visual overflow bounds. Font bounds are cached per font/size, and shaping y-offsets are included when composing. Unknown font bounds conservatively disable culling for affected content. The caller still supplies the canvas clip. Ordinary `draw()` remains available for export and comparison. The demo UI is unchanged.

The implementation culls paragraphs, not individual lines or glyphs inside a very long paragraph. Future decorations and custom blocks that paint outside their rectangles must contribute visual bounds. The viewport query does not reshape text or create render buffers.

## Drawing

10,000 distinct styled paragraphs, 500×640 software canvas. Five warmups and 30 measured trials per position, alternating full/cull order. These include canvas clearing and flush, exclude PNG encoding, and are not GPU/browser-presentation timings. Medians in milliseconds.

| Browser | Position | Full draw | Culled draw | Paragraphs submitted | Glyph runs submitted |
|---|---|---:|---:|---:|---:|
| chromium | top | 10.70 | 1.20 | 10 | 30 |
| chromium | middle | 10.90 | 1.20 | 11 | 33 |
| chromium | bottom | 14.50 | 1.50 | 11 | 33 |
| firefox | top | 14.00 | 2.00 | 10 | 30 |
| firefox | middle | 13.00 | 2.00 | 11 | 33 |
| firefox | bottom | 13.00 | 2.00 | 11 | 33 |
| webkit | top | 11.00 | 1.00 | 10 | 30 |
| webkit | middle | 11.00 | 1.00 | 11 | 33 |
| webkit | bottom | 12.00 | 1.00 | 11 | 33 |

## Adaptive chunk experiment

Both paths use block-local updates and viewport drawing. Fixed batches contain 500 paragraphs. The experimental adaptive loop starts at 16, targets 8ms of work, limits batches to 1–256 paragraphs and changes the next batch by at most a factor of two. Each update yields via setTimeout(0). It is a feedback experiment in the validation harness, not a shipped network/frame scheduler or a hard time guarantee. A synchronous update and garbage collection cannot be preempted.

Three trials per policy, alternating order. Work includes parsing generated JSON block chunks, splice/layout, draw and flush; transport and initial font/WASM load are excluded. The first adaptive submission contains fewer paragraphs than the fixed submission. Elapsed time includes scheduler yields. Medians are reported except worst update and the count above 16ms, which use all updates across all three trials.

| Browser | Policy | First submission ms | Total work ms | Final submission elapsed ms | Worst update ms | Updates over 16ms / all updates |
|---|---|---:|---:|---:|---:|---:|
| chromium | fixed 500 | 25.10 | 520.70 | 624.10 | 43.60 | 60 / 60 |
| chromium | adaptive | 2.70 | 677.20 | 1114.30 | 12.20 | 0 / 283 |
| firefox | fixed 500 | 29.00 | 605.00 | 720.00 | 40.00 | 60 / 60 |
| firefox | adaptive | 3.00 | 1126.00 | 1988.00 | 18.00 | 2 / 420 |
| webkit | fixed 500 | 22.00 | 439.00 | 576.00 | 25.00 | 60 / 60 |
| webkit | adaptive | 1.00 | 608.00 | 1225.00 | 11.00 | 0 / 234 |

## Correctness and limits

All browsers compare exact PNG bytes for full and culled drawing at DPR 1, 1.5 and 2, fractional scroll offsets, top/middle/bottom and outside-document viewports. Additional cases use stacked combining accents to verify visual overflow is preserved. Final adaptive/fixed layouts and viewport pixels match the complete document. Counters check local validation/composition, no layout work during drawing, and snapshots after release.

Smaller batches improve responsiveness and first submission at the cost of more total work and longer completion time. Each splice still rebuilds document placement/flat lines, and every batch yields. An incremental placement index is the next scaling target if that overhead dominates. The 8ms target is intentionally soft; inspect the worst-update column rather than assuming all updates meet it.

## Reproduce

Build with `npm run build:owned` and serve the owned production preview on port 5175. Run `node scripts/check-owned-viewport.mjs`, then `node scripts/report-owned-viewport.mjs`. `OWNED_URL` can select another server. Raw samples: `artifacts/owned-viewport.json`.
