# Long-session undo retention

The local history module now coalesces consecutive document snapshots for the
same roots inside an undo group. It retains the earliest `before` and latest
`after` snapshot when the intermediate nodes match by identity. This preserves
strict replay conflict checks, grouping, selection bookmarks and stored marks.
Changes to different roots or incompatible structural changes remain ordered.
Transform result objects are never mutated while coalescing.

All position maps and operation identities remain intact. A reference captured
halfway through a typing group can still resolve after undo/redo and after saving
and reopening a position checkpoint. Snapshot coalescing does not compact durable
reference history or limit reference lifetime.

## Measurement

Run `pnpm run benchmark:session-retention`. It builds the public packages, then
measures each case in its own Node process with explicit garbage collection and a
warm-up. Three trials compare 1,000 and 5,000 appended characters, with and without
history. It verifies undo, redo and durable-position resolution and writes
`artifacts/editor-session-retention.json`. Use `RETENTION_REPORT` to select another
output file.

On this machine with Node 24.21.0, median retained heap growth after 5,000 edits was:

| Configuration                  |   Before |    After |
| ------------------------------ | -------: | -------: |
| No undo history                |  3.45 MB |  3.45 MB |
| One typing undo group          | 17.95 MB |  4.18 MB |
| Serialized position checkpoint | 0.735 MB | 0.735 MB |

That is about 77% less retained heap for this typing workload. Median undo time
fell from 1.98 ms to 0.87 ms. These are local measurements, not cross-device budgets.
Raw results: [before](../artifacts/editor-session-retention-before.json) and
[after](../artifacts/editor-session-retention.json).

## Remaining work

Position checkpoints and the operation journal still grow with edits. History
still retains mapping arrays and separate snapshot runs when edits alternate
between roots. Large pasted/deleted content also remains retained for undo. The
history depth bounds groups, not bytes. This change does not establish bounded
memory for arbitrary sessions or collaboration-safe selective undo.

The next investigation should measure checkpoint growth for structural edits and
references captured at many revisions. Compaction must preserve unknown external
references; dropping old revisions is not an acceptable shortcut.
