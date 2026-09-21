# Relative-position lookup performance

Recorded 2026-09-20. This fixes repeated mapping replay in the owned relative-position implementation. It adds no dependencies, serialization boundary or range registry.

## Cause and change

Previously every range replayed every effective mapping after its capture revision. Sharing a flattened mapping suffix avoided rebuilding the list, but each range still walked it. The original 1,000-range / 10,000-edit reproduction took about 120 ms including initial lookup. Adding ranges captured at different revisions exposed another cost: repeated suffix construction took about 329 ms for one pass.

The index now shares summaries by node key and capture revision. Each text summary records a conservative affected interval and total offset change. Positions known to remain outside that interval can skip replay or apply the combined shift. Endpoint associations and complete-range deletion have separate checks, so a zero net length change does not erase replacement semantics.

Undo/redo uses the last occurrence of each operation and its toggle parity after the capture revision. Ordinary operation segments share revision indexes; restored operations contribute only when they survive cancellation for that query. Neither index tracks external ranges or needs their IDs.

Ambiguous queries use exact replay, with summaries over chunks of 64 mappings to skip safe sections. The exact-replay cache has a 32-entry limit and an approximate 100,000-mapping weight budget, retaining at most one larger entry. Structural changes can force fallback. The shared index rebuilds lazily after an edit and costs memory/work proportional to retained mapping history. This is not a worst-case constant-time algorithm.

## Measurements

Run `pnpm run benchmark:relative-positions` with the development server on port 5173. The script asserts correct resolution and a median under 16 ms, including index construction. It records three serial Chromium trials on the local Apple M4 Pro. Varied workloads have 1,000 distinct ranges across 100 blocks, about 10,000 edits, and 12 passes each preceded by another edit to invalidate the index.

[Raw current results](../artifacts/editor-foundation-relative-index/positions.json), [pre-optimization original workload](../artifacts/editor-foundation-relative/positions.json).

| Workload                                      | Median pass including index construction | Largest observed varied pass |
| --------------------------------------------- | ---------------------------------------: | ---------------------------: |
| Original shared-revision reproduction         |                                   3.0 ms |                            — |
| Edits before endpoints, including a net shift |                                   2.3 ms |                       7.7 ms |
| Edits inside ranges                           |                                   2.3 ms |                       4.0 ms |
| Edits at range boundaries                     |                                   1.3 ms |                       2.4 ms |
| Distributed block edits outside ranges        |                                   1.3 ms |                       3.2 ms |
| Different capture revisions                   |                                   1.2 ms |                       2.7 ms |
| Different capture revisions with undo/redo    |                                   1.2 ms |                       3.3 ms |

The original workload improves by about 40 times including construction. Warm lookup of its 1,000 ranges alone has a 0.3 ms median. These synthetic measurements do not establish physical presentation latency or cover every structural-edit history. Exact replay remains a potentially expensive fallback when summaries cannot establish a safe result.

The serialized checkpoint remains 1,426,801 bytes after 10,000 edits. The format and retention policy are unchanged. Transient indexes add memory while in use; checkpoint byte counts are not total heap measurements. Durable storage compaction still needs a separate design that preserves unknown external references.

## Correctness

Public-core tests compare the optimized resolver with an independent exact-replay interpreter through deterministic varied replacements, Unicode boundaries, splits, multiple capture revisions, undo/redo and checkpoint reload. Directed tests cover inclusive full replacement and opposing length changes. The comparison caught and corrected an initial lower-bound mistake: a point before all edits never accumulates preceding deltas, whereas a point after all edits does.

The build passed. The full Chromium, Firefox and WebKit suite passed 108 tests, with three skips for the unimplemented collaboration-convergence scenario. Existing structural, permission, history and external-comment tests remain part of the suite. Large-document regression medians were 1,003 ms for progressive load, 50.5 ms for full-book paste handling, 32.0 ms for typing to the second frame and 31.51 MB loaded JS heap. All remain within the existing budgets. [Raw large-document results](../artifacts/editor-foundation-relative-index/baseline.json). Faster load/paste samples should be treated as run variation, not attributed to an index the demo does not yet exercise.

## Next work

Use the new session APIs in the real editor: migrate demo comments to external threads and decorations, route toolbar actions through command chains, and complete the headless/React view separation. This provides an end-to-end test of the extension contracts before expanding them.

Then run the bounded authority/OT and Automerge comparison from the implementation plan. Focus on concurrent structural edits, collaborative undo, durable external references and permission-aware synchronization. Choose the long-term identity and history-compaction strategy from those results. Fast query summaries do not settle the collaboration storage model.
