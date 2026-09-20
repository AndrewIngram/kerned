# Book loading performance

The book loader now sizes batches using the cost of composing new paragraphs. It previously used the total render and drawing cost, which also includes bookkeeping over the document already loaded. As that fixed cost grew beyond the 8 ms target, the controller reduced batches to eight blocks. Smaller batches then repeated the same expensive bookkeeping more often.

The controller still targets 8 ms, clamps batches to 8–128 blocks, and waits for each committed canvas paint before loading more. The scene reports paragraph-composition time separately; the diagnostic `workMs` measurement continues to include render and drawing work. This corrects the feedback loop without changing document content, load ordering, or editing history.

## Measurements

Local development server, headless browsers, 1,100 × 900 viewport, 2026-09-20. Times start when loading resumes from the first 32 blocks and end at the final canvas paint. They exclude initial asset fetching and HTML parsing. Each row is a single run, so these are comparisons rather than latency guarantees.

| Browser | Warbreaker, Find closed | War and Peace, Find closed | War and Peace, Find open |
|---|---:|---:|---:|
| Chromium | 1.05 s | 2.43 s | 2.86 s |
| Firefox | 1.50 s | 4.23 s | 4.58 s |
| WebKit | 0.99 s | 1.99 s | 2.41 s |

An unprofiled Chromium comparison restores only the old controller in the test browser. Warbreaker took 6.27 s over 375 batches; War and Peace took 17.32 s over 958 batches. The updated runs use 59 and 107 batches respectively. War and Peace contains 11,718 blocks versus Warbreaker's 7,280; its longer paragraphs add composition work as well as text volume.

With Find open, existing highlights and counts remain visible while newly appended text is searched. Across both books and all three browsers, the updated run recorded zero disappearing-highlight frames, count decreases, busy-indicator frames during same-query appends, or stale-layout paints. The benchmark also waits for the final result count to match the complete document.

Raw reports: [updated browsers](../artifacts/editor-loading-after.json), [old controller comparison](../artifacts/editor-loading-controller-before.json), [final streaming count checks](../artifacts/editor-loading-find-verified.json), and [original Find flicker reproduction](../artifacts/editor-loading-before.json). The last report includes a profiled run and should not be used as the clean controller timing comparison.

## Reproduce

With the demo running at `http://127.0.0.1:5173`:

```sh
BROWSERS=chromium,firefox,webkit REPORT=artifacts/editor-loading-after.json node scripts/benchmark-editor-loading.mjs
BASELINE=1 FIND=off REPORT=artifacts/editor-loading-controller-before.json node scripts/benchmark-editor-loading.mjs
HYBRID_URL=http://127.0.0.1:5173/editor.html node scripts/check-war-and-peace.mjs
```

`SAMPLES=war-and-peace` selects one book; `FIND=on` selects the streaming-search case. `PROFILE=/tmp/editor-loading` optionally saves Chromium CPU profiles, separately from clean timing runs. `BASELINE=1` intercepts the served module only in the test browser; it does not edit source files.

The editor still copies or scans whole-document structures during appends. This change reduces how often that happens; it does not make all document updates independent of document size. Future scaling work can measure those remaining costs with this benchmark.
