# Generic containers and nested lists

The editing core supports immutable trees through schema capabilities. A headless list extension builds on the public API. No new runtime dependency, worker message or serialization boundary was added.

## Core contract

Container extensions supply child access, immutable child replacement and parent-aware content validation. Node IDs and stable keys must be unique across the tree. The core indexes structure without interpreting list, paragraph or table names.

Transactions support `insertChildren`, `replaceChildren`, `removeChildren`, `moveChildren`, `wrapChildren` and `unwrap`. A null parent addresses document roots. Move destination indexes apply after removal. Moving into a descendant is rejected. Structural edits must preserve the text and identity of surviving nodes; text changes use mapped text steps instead.

Content rules are validated against the completed transaction. Commands can therefore create a container and fill it in the same atomic operation. Rejected commands publish no partial state. Text replacement, split/join, identity allocation and anchors now work inside containers. Joining still requires adjacent siblings; it is a structural operation, not a visual-navigation rule.

Stable keys and text offsets survive wrapping and reparenting. Subtree deletion marks affected anchors deleted. Local history stores conditional changed-root fragments, which can retain ancestor branches. Undo preserves later streamed roots, but is not selective collaborative undo. Deleted-anchor status remains sticky; restoring content does not silently resurrect a reference.

## List extension

`src/extensions/lists.ts` exports `createListExtensions(adapter)`. Applications provide their own node representation and identity allocation. The result supplies two container extensions and commands for wrapping, indenting, outdenting, Enter and Backspace, plus derived marker labels and depths.

Lists contain nonempty items. An item starts with a block and may contain more blocks and nested lists. Ordered lists carry a positive start value. Numbering is derived from sibling order rather than stored on every item. Lifting a middle item splits its list and preserves the following segment's numbering. Nested outdent moves the selected item; following siblings remain in their existing parent.

Enter splits an item and moves its trailing content into the new item. Enter on a single empty text block exits or lifts the item. Backspace at the first block's start joins the preceding item or outdents the first item. The host decides when to invoke these commands and supplies transaction metadata.

The writing demo wires these commands through `src/extensions/blocks.ts` and its Blocks menu. See [current block interactions](editor-block-ui.md).

## Tables: tree structure is not selection geometry

A rectangle of visually adjacent cells can correspond to disjoint ranges in tree order. Flattening it to the minimum and maximum text offsets would select unrelated cells. Rowspan and colspan also mean that child indexes are not logical grid coordinates.

The table extension should own its logical grid, spans, navigation, rectangular selection rules and clipboard/edit commands. Core selection needs an extensible contract for mapping, serialization, history bookmarks and resolving selections to multiple nodes or ranges. Persist stable cell identities and selection intent; recompute pixel geometry from layout.

The subsequent [selection milestone](editor-selections.md) adds cross-block text, node, whole-document and custom selections, including a headless cell-selection extension. Table rendering and interactions remain unfinished. The [ProseMirror selection investigation](prosemirror-selection-research.md) records the contract to follow, including text, node and whole-document selections, custom cell selections, and history bookmarks.

This separation is consistent with [ProseMirror's table module](https://github.com/ProseMirror/prosemirror-tables/blob/master/README.md), which supplies a cell selection class, grid mapping, commands and invariant handling in addition to its schema.

## Validation and scaling

`npm run check:transactions` checks nested structure through an independent schema using only public APIs. Coverage includes numbering, multi-level indent/outdent, Enter/Backspace, generic structural operations, durable references, atomic rejection, streamed-root preservation, undo/redo, disjoint branch edits, and wrapping 2,000/10,000 blocks. Bulk wrapping is a single `replaceChildren` step, avoiding repeated tree scans per item.

Transaction checks passed at wide and narrow viewports in Chromium, Firefox and WebKit. The existing hybrid, large-document and viewport-reflow suites also passed across all three browsers, including 10,000 blocks and concurrent streaming.

`npm run benchmark:containers` measures `editor.dispatch` directly: one-character edits in 2,000/10,000 text leaves, flat or under one generic container, three warmups and 20 samples per case. The existing edit-to-paint metric starts after dispatch and cannot measure this cost.

Measured median / p95 milliseconds in one run:

| Browser | 2k flat | 2k nested | 10k flat | 10k nested |
|---|---:|---:|---:|---:|
| Chromium | 0.85 / 1.1 | 0.70 / 0.9 | 3.4 / 4.0 | 3.4 / 3.8 |
| Firefox | 2 / 2 | 1 / 3 | 7 / 10 | 7 / 11 |
| WebKit | 1 / 1 | 1 / 1 | 2 / 3 | 2 / 3 |

Raw browser versions and samples are in `artifacts/editor-container-benchmark.json`. These are transaction costs, not end-to-end input latency or a controlled before/after comparison. Indexes are reused within a transaction, but indexing still scales with total node count. Immutable edits copy sibling arrays and affected ancestor paths. Persistent incremental indexes and structural history compaction remain opportunities before substantially larger documents.
