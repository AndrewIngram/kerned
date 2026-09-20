# Editor foundation implementation progress

Updated 2026-09-20. This records implemented slices of the [implementation plan](editor-implementation-plan.md), not completion of the schema migration or collaboration backend.

See the [implemented session API guide](editor-session-api.md) for commands, React, permissions, comments and proposals.

Subsequent performance work: [indexed relative-position lookup](relative-position-performance.md).

## Implemented

- Snapshot-bound text points and structural gaps, tree context, ordering, and forward/undo/redo transition mapping.
- Independent serialized relative positions and ranges. The rejected range registry is removed; the document stores edit metadata rather than external ranges. See [position semantics and persistence](editor-references.md).
- Optional node access policy at the dispatch and undo/redo boundary. Source and result validation catches indirect deletion, protected/read-only content changes and locked descendants. Join and undo checks prevent protected text from being copied into an editable destination. Whole-node movement/deletion remains possible subject to editable parent structure and deletion locks. Access is inherited down the tree; descendants cannot override a protected/read-only ancestor.
- A general `locked` property on `NodeIdentity`, shared by demo node types and preserved through heading conversion.
- `projectDocument`: protected subtrees become minimal placeholders before transport; visible containers carry childless node data and separate projected children. Tests check initial and subsequent projections for hidden sentinels. This is a projection primitive, not an implemented secure synchronization transport. Never send raw canonical steps, history or position checkpoints to restricted clients.
- Generic semantic mark ranges, extension-defined attribute parsers and text-storage adapters. The formatting toolbar uses generic selection mark steps. Versioned node codecs cover the starter kit and preserve durable identities. See [marks and codecs](marks-and-codecs.md).
- Atomic `editor.chain()` commands over draft state and side-effect-free `editor.can()` checks. A later failed command abandons earlier draft changes. Permission revocation before execution is rechecked.
- Optimistic text replacement proposals with external ranges, expected node keys/text and a checked base revision. Unrelated edits can be tolerated; changed targets and stale commits reject. This is not general OT rebasing, exactly-once delivery or automatic schema/formatting conflict resolution.
- Stored marks for caret formatting, input inheritance, Enter, selection reset and undo/redo. The demo uses the core input path for canvas text and table cells.
- Framework-independent browser event ownership and viewport observation, used by both demos. Optional React `Editor` handles mounting/cleanup without owning the session. `useEditorState` suppresses unchanged selected values; `useCommandState` observes activity and availability.
- Typed extension state fields with atomic pre-publication reducers, command draft support and reentrancy rejection. Public React renderer registration is used for starter-kit nodes, mentions, underline drawing and external comment decorations.
- Direct semantic mark and inline-value storage in the starter kit. Layout-only projections retain compact font runs and inline boxes. Mark extensions can control boundary inclusion; inline extensions own attribute validation, layout/plain-text projection and versioned codecs.
- Durable serialized structural gaps attached to node edges, including movement, wrapping, deletion, undo and reload. Shared text/gap coordinate kernels serve snapshot mapping and extension selections. Text reference replay and interactive selection recovery retain their distinct policies.
- Command definitions with active/inactive/mixed queries, permission-aware availability, queued success effects and caret stored marks. The demo formatting actions use the shared toggle command.
- Public inline decoration resolution and external comment-thread records. Threads retain their own IDs, messages and endpoint values; core nodes contain none of those fields. The demo now stores discussion threads outside document nodes, resolves their relative ranges into canvas decorations, and keeps replies independent of text history and rich clipboard content. Streamed samples seed external threads as their content arrives.

## Validation

`npm test` passed 162 tests across Chromium, Firefox and WebKit, with three skips: the same still-unimplemented concurrent split/insert convergence scenario in each browser. Final focused verification passed 45 tests, including two additional cases per browser for command-chain mark resets and framework-free nested text capture. No expected failures are counted as implemented behavior. Coverage includes real React mount/unmount, permission revocation, undo, failed multi-step transactions, external comment decoration resolution, nested/disjoint selections and existing demo editing/formatting.

The mixed-block streaming checks pass all nine cases across the three browsers (2,000/10,000 blocks, desktop/narrow viewports), including 501 resolved external threads at 10,000 blocks. An old image-spacing expectation was updated to account for the existing four-pixel baseline grid; the no-extra-shaping assertion remains intact.

`npm run build` passes type checking, production bundling and the core import boundary checks. Tests use an independent schema through public exports, so they do not rely on demo field names or test-only permission implementations.

## Large-document regression measurements

Three serial development-mode Chromium trials on Apple M4 Pro; Warbreaker contains 7,280 blocks and 1,117,497 plain-text characters. [Original baseline](../artifacts/editor-foundation/baseline.json), [current measurements](../artifacts/editor-runtime-extensions-fixed/baseline.json).

| Measurement | Original median | Current median |
| --- | ---: | ---: |
| First usable editor | 204 ms | 199 ms |
| Progressive load after resume | 1,087 ms | 1,003 ms |
| Full-book rich paste handler | 52.2 ms | 53.1 ms |
| Paste to second animation frame | 102.2 ms | 102.3 ms |
| Typing to second animation frame | 31.8 ms | 31.9 ms |
| Paging to second animation frame | 32.0 ms | 32.1 ms |
| Loaded JS heap after GC | 31.36 MB | 31.93 MB |

An initial regression rebuilt the full tree for each toolbar mark query. Reusing the existing tree index removed it. `npm run check:editor-performance -- artifacts/editor-runtime-extensions-fixed/baseline.json` enforces the initial review budgets: 20% beyond the original maximum for loading/paste, 15% for heap, or an extra frame for typing/paging. Existing paste correctness, undo/redo and stale-paint checks pass. Frame timings include scheduling; heap excludes GPU/native memory. These default-demo measurements do not establish large-document permission-validation or decoration-resolution costs. The [lookup optimization report](relative-position-performance.md) records the subsequent fix, including different capture revisions and undo/redo.

## Remaining implementation

- Authority operation transforms and collaborative undo; the bounded Automerge comparison and idempotent delivery.
- A durable storage strategy that bounds retained metadata while preserving unknown external references. Indexed lookup now skips safe replay; persisted history still grows.
- Permission-aware client update transport, revocation handling, restricted reference resolution and protected-text/mark semantics. Projection must run at a trusted boundary, and application-defined metadata must not duplicate hidden descendant content.
- Automatic schema migrations and application persistence. The starter-kit paragraph/heading codecs are version 2; older serialized inline payloads require migration.
- Packaging the application-owned CanvasKit scene and starter-kit shortcuts into a configurable ready-made editor assembly. The generic browser runtime and React host are implemented and used, but consumers still supply these policies and their renderer.
- Durable mixed text/structural range semantics, if needed by future features. Structural gaps follow surviving edge identities; both-edge deletion is explicit. Text comments retain their existing durable range behavior.

These are remaining engineering tasks, not requests for another round of routine decisions. Offline guarantees and trust/encryption assumptions still belong at the collaboration architecture gate.
