# Editor foundation implementation plan

Status: proposed implementation sequence, 2026-09-20. Planning is complete enough to start the first milestone. Collaboration, permission enforcement and the new APIs are not implemented by this document.

Implementation progress: [implemented APIs, validation and remaining work](editor-foundation-progress.md). Snapshot mapping, independently serialized relative ranges, node access/locking, projection, command chains, optimistic text proposals, external comment decorations and a React state hook are implemented. The rejected registered-range store has been removed. [Position persistence](editor-references.md) currently retains document mapping metadata and is not a final collaboration storage design.

## Objective

Deliver a framework-independent editor with extension-defined nodes, marks and decorations; transactional commands; durable reference contracts; optional React rendering; and a path to collaborative editing with partial document access. Preserve the owned TypeScript layout pipeline and the existing editing experience.

Inputs:

- [Editor API proposal](editor-api-proposal.md)
- [Position and range proposal](editor-position-proposal.md)
- [Collaboration and permissions proposal](collaboration-permissions-proposal.md)
- [Wordgard research](research-wordgard.md)

## Decisions and remaining questions

Established direction:

- Core supplies generic content and editing semantics. Starter-kit extensions define paragraphs, headings, lists and tables.
- Marks are document content; decorations are derived view augmentations. Comments own anchored data outside generic text nodes.
- Commands build atomic transactions over an imperative session. Capability queries have no observable effects.
- Input, selection and viewport behavior work without React. React adds components, subscriptions and renderer integration.
- Positions have an explicit state and coordinate context. Runtime node IDs, durable occurrence identities and visual caret geometry are distinct.
- Protected content is omitted before delivery to unauthorized clients. Client command checks supplement trusted enforcement.
- Keep OT provisional; evaluate Automerge against the same cases. Do not install both as permanent production backends.
- Comment ranges remain resolvable for as long as their referenced range survives. Insertions inside the range become part of it. Restart, elapsed time and history compaction must not expire a surviving range, including externally stored references.
- Locking is a general node property, available on every node type and independent of the current user's editable/read-only/protected access. Read-only and protected nodes can be moved and deleted as whole nodes, subject to structural authorization and the node's lock. A locked node cannot be deleted by a principal without edit access, including through ancestor deletion. The lock does not implicitly prohibit movement.

Open product decisions can be deferred to the specified gate:

| Question | Planning assumption, not an agreed product restriction | Decision deadline |
| --- | --- | --- |
| Must edits merge after days offline? | Test connected/reconnect workflows first, plus a long-disconnection fixture. Do not promise indefinite offline merging. | Collaboration choice in milestone 3 |
| Is the server allowed to read canonical content? | Use a trusted authority in the permission prototype. End-to-end encryption is not included in that prototype. | Before choosing deployment/security architecture in milestone 3 |
| What do permissions on a mark protect? | Test both an immutable visible annotation and protected underlying text as distinct capabilities. | Milestones 3 and 4 |

These questions do not block model fixtures or position contracts. They do block unsupported promises about offline behavior, privacy or durable storage. Record decisions when made instead of treating assumptions as user approval.

## Milestone 1: executable requirements and baseline

Start with the existing public selection/schema/transaction APIs. Add focused fixtures for nested headings and paragraphs, lists, table cells, inline atoms, overlapping annotations and permission placeholders. Fixtures should state expected outcomes independently of the implementation's internal representation.

Capture existing performance on the same machine and browser for typing, large paste, streaming book load, retained memory and selection navigation. Record document size, sample, build mode, repetitions and observed variation. Set regression budgets from those measurements before evaluating replacements; do not invent latency claims or treat one run as a benchmark.

Reuse existing navigation, rich-paste, bulk-edit and loading checks. Identify which checks prove behavior and which are tied to demo instrumentation so the latter can migrate with the view.

Deliverable: a small executable scenario suite and a baseline report. No production data-model switch.

Exit: fixtures cover split versus concurrent insert, cross-container selection, rectangular cell selection, deleted anchors, allowed deletion of an unlocked read-only node, denied parent deletion containing a locked node and a stale agent replacement. Existing demo checks still pass.

## Milestone 2: position, range and change contracts

Implement snapshot-bound text points and structural child gaps, ancestor resolution, document ordering and common-ancestor queries. Retain node-local coordinates for layout. Use indexed subtree information where needed rather than rescanning the full document for each cursor movement.

Define directed selection versus ordered range versus range set. Specify endpoint association, deletion outcomes, content-following behavior and visual affinity separately. Add exact, fallback, deleted, restricted and unavailable resolution outcomes where applicable.

Unify mapping semantics used by selections and durable anchors. Cover replace, split, join, insert/remove, move, wrap and unwrap. Specify copied occurrence IDs and identity behavior through split/join/undo. Expose a versioned anchor envelope while leaving backend-specific identity payloads unsettled until milestone 3.

Prototype the generic semantic node/mark contract through a small independent schema. Keep physical persistent storage and wire-operation formats provisional. A shared semantic API does not imply that OT and Automerge have interchangeable internal representations.

Likely implementation starting points are `src/editor/positions.ts`, `src/editor/anchors.ts`, `src/editor/tree.ts` and `src/editor/selection.ts`.

Exit: semantic tests exercise nested content, both endpoint associations, emoji boundaries, disjoint ranges, movement and deletion/undo. Mapping composition agrees with sequential mapping for surviving references. No claim of concurrent convergence yet.

## Milestone 3: bounded collaboration and permission experiment

Build two disposable implementations of the same small scenario set: an authority-ordered operation/rebase prototype and an Automerge prototype. Use the semantic fixtures from milestones 1 and 2; allow backend-specific operations, storage and anchor encodings.

Limit scope to enough structure to test the decision: text and marks, two nested containers, split/join, movement, an inline atom and a protected region. Do not implement two complete editors, production transports or duplicate all table commands.

For both candidates, test:

- Concurrent text insertion/deletion and overlapping mark changes.
- Split versus edit, join versus edit and move versus edit, including references following surviving content.
- Convergence, schema validity and explicit conflicts where an operation cannot preserve intent.
- Undo after remote edits and checkpoint/reconnect behavior.
- Old serialized comment ranges still resolving after reload and compaction, including newly inserted interior content and surviving ranges whose original endpoints were deleted.
- Idempotent delivery and an agent proposal with matching or failed preconditions.
- Three permission views of one logical document: editable, read-only and redacted.
- General node locking across node types and user access states; revocation during an outstanding edit; permitted movement/deletion of unlocked read-only/protected nodes; deletion locks checked through ancestors; unauthorized annotation removal.
- Incremental projection cost, load time and retained memory against the recorded baseline.

Inspect delivered snapshots and update payloads, not only the UI. Hidden sentinel content must not appear in unauthorized updates, history, search/outline results, clipboard responses or agent input. Test how editing around a placeholder maps back to canonical content.

Automerge document partitioning and authority-projected documents are alternative approaches to partial access; do not assume arbitrary filtering of CRDT updates is valid. If a candidate cannot support the access model with acceptable complexity, record that as a decision result rather than weakening the requirement silently.

Exit: publish a decision record choosing one direction, or identifying a specific unmet requirement. Settle offline and trusted-server assumptions here. Finalize storage and operation identity only after this result. Remove disposable code that will not be used.

## Milestone 4: first complete editor API slice

Build a generic text-containing node plus extensible bold/link marks, comments backed by anchors and decorations, and a small starter kit. Add schema codecs and canonical mark normalization. Keep persistence names distinct from runtime handles. Preserve unknown content according to an explicit codec policy rather than silently dropping it.

Extract an imperative session with immutable published snapshots, a transaction builder, selector subscriptions and atomic dispatch. Introduce the command facade, atomic chains and active/inactive/mixed capability queries. Focus and scroll effects run only after a successful commit. Extension state reducers cannot dispatch reentrantly.

Permission queries feed command availability; the trusted validator checks actual transaction effects. Comments and search use public decoration providers. History operates on the chosen transaction contract and remains separate from rendering.

Exercise the same slice through a plain JavaScript mounted view and an optional React adapter. Move shared input, composition, pointer/keyboard selection, clipboard and viewport behavior out of React demo assembly as needed for that slice.

React supplies an Editor component, lifecycle/selector hooks and custom node/mark/decoration renderers. Canvas descriptions and measured DOM overlays use explicit metric/paint and event-ownership contracts. Keep edited text geometry owned by the engine. External session ownership must survive view unmount.

Exit: the slice works without React, custom schemas do not require paragraphs, comments need no special core fields, clipboard and undo preserve marks, failed chains make no changes and paint-only decorations trigger no shaping. Test headless commands, browser interactions and mount/disposal.

## Milestone 5: migrate the existing editor and extensions

Migrate headings, lists, quotes, tables, mentions, images, embeds, clipboard codecs, find and outline through the proven interfaces. Preserve text/node/all/cell selections and table-specific structural behavior. Enforce permissions for compound commands and their normalization effects.

Replace fixed `spans`, `atoms` and `comments` handling in the demo model with the appropriate generic content and extension state. Migrate callers then delete replaced adapters. Small temporary internal adapters are acceptable within a milestone, but do not publish parallel legacy and replacement APIs.

Move the clean demo and hybrid preview onto the same browser runtime. This migration does not require a new visual design. If unavoidable UI ambiguity arises, use the existing UI exploration process.

Exit: navigation, selection, formatting, lists/tables, rich clipboard, streaming outline and large-document checks pass. Compare performance against milestone 1. Investigate material regressions before adding more capabilities.

## Milestone 6: durable storage and collaboration hardening

Implement the selected production sync path, authoritative authorization, persistence, reconnection and acknowledgement handling. Keep actor identity, operation identity, confirmed server version and local pending state distinct. Validate and authorize transformed operations atomically against current state.

Implement retention and migration that preserve old serialized anchors while their ranges survive. Test externally stored anchors after reload and compaction, interior insertions, partial deletion, permission-restricted resolution and deletion/undo. Updating only registered comments is insufficient. Specify collaborative history semantics so undo does not restore another user's work indiscriminately.

Implement agent proposals with base context, stable target, content/structure preconditions and idempotency. A mapped target does not waive a failed precondition. Return conflicts that callers can inspect and re-plan against.

Test permission changes against caches, histories, exports, presence and projected outlines. Never replace canonical content with a client projection. Distinguish permission-redacted content from authorized content that is merely not loaded.

Exit: automated multi-client scenarios, reconnect/retry tests, payload disclosure checks, storage migration tests and measured large-document behavior. Document supported offline behavior and prove reference durability for surviving ranges; range age or map compaction is not an acceptable expiry policy.

## Scope and sequencing

Start with milestone 1, then position contracts in milestone 2. The collaboration experiment is a gate before hardening persistence and migrating the entire model. No full collaboration backend is required to prove the first fixtures, and no final merge-engine choice is required to define their expected behavior.

Keep layout, shaping and rendering owned throughout. A collaboration dependency must not become a per-glyph query service. No custom CRDT algorithm, new WASM layout engine, transport deployment or broad demo redesign is part of the initial milestone.

The first reviewable result is the scenario suite and baseline, followed by a position/range implementation. Implementation authorization can cover these milestones without approving unresolved product assumptions or a permanent dependency choice.
