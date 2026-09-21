# Positions, ranges and collaborative edits

Status: proposal, 2026-09-20. Complements [the editor API proposal](editor-api-proposal.md). No production position API has changed.

Permission-limited document views add another coordinate boundary. See [collaboration and partial document access](collaboration-permissions-proposal.md) for protected placeholders, restricted anchor resolution and authoritative validation.

## Current behavior and limits

`src/editor/selection.ts` addresses text by runtime node ID and UTF-16 offset. Its tree index finds nested text nodes, and text selections can enumerate ranges across containers. Replacement across different parents explicitly requires an extension command. Addressing a range and deciding how to restructure its content are separate problems.

`src/editor/positions.ts` maps text replacement, split and join. `src/editor/anchors.ts` adds document identity, revision, stable node key, insertion bias and deletion tracking. Those anchors need a continuous revision-map journal. They cannot currently represent structural gaps. Selection mapping currently uses a fixed forward bias, while durable anchors expose a bias. These contracts need reconciliation without imposing identical behavior on every consumer.

Transactions reject stale base revisions. This prevents accidentally applying old coordinates but does not rebase a concurrent edit. Local numeric revisions also do not describe divergent client histories.

## Distinguish four concepts

1. A snapshot position addresses one location in a particular document state. It can be a text offset inside a node or a child gap inside a container, including an empty container. A runtime node ID or child index is meaningful only in that state.
2. A resolved position adds ancestor, sibling and ordering information for structural commands. Resolve it against a snapshot; do not persist its path.
3. A durable anchor carries enough identity and mapping context to resolve later, or to report that resolution is no longer possible. A node-relative offset alone is not durable.
4. A visual caret location adds layout-specific information such as upstream/downstream affinity at a soft wrap. Layout coordinates and visual affinity are separate from insertion association used when mapping edits.

ProseMirror's resolved positions expose ancestor and shared-parent information over a linear document address. Linear coordinates and tree structure are compatible. [Primary source](https://raw.githubusercontent.com/ProseMirror/prosemirror-model/master/src/resolvedpos.ts)

## Coordinate alternatives

| Representation                           | Appropriate use                                                | Limitation                                                                              |
| ---------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Absolute tree-token offset               | Snapshot ordering, interval queries and transaction algorithms | Must map after changes; structural boundaries must be counted, not just text characters |
| Node-local offset or container child gap | Owned layout, local editing and structural commands            | Needs document ordering and explicit mapping after split, join, removal or gap changes  |
| Child-index path                         | Temporary resolved context                                     | Ancestor insertion and movement invalidate it; unsuitable for persistence               |

Keep node-local coordinates on the layout hot path. Add structural gaps and a resolver that can compare positions, expose ancestors and compute common-ancestor ranges. A tree index can supply absolute ranks when required without making every edit rewrite every node's offset. Cache subtree sizes and update affected paths; benchmark the implementation rather than assuming its complexity from the API.

Every position-consuming operation must establish its document state. Bind query helpers to a snapshot and transaction builders to a base plus evolving draft. Do not allow naked numbers to silently cross revisions. Use distinct types for UTF-16 offsets, child indices and any global ranks. Interactive editing respects grapheme boundaries even though text offsets use UTF-16 units.

## Range and mapping semantics

A directed text selection has anchor and head; an ordered range has start and end. Node selection and cell selection remain different types. A rectangular cell selection can enumerate multiple disjoint document ranges. Do not force it into one interval.

Persistent range endpoints have explicit insertion association. Specify inclusion at both edges, behavior for internal replacement, and what happens when all referenced content is removed. Defaults can differ for comments, formatting, search and selections. A range that follows moved content may become disjoint; a contiguous interval and a set of content references are different contracts.

Mapping must cover insertion, replacement, split, join, subtree movement, wrapping, unwrapping and deletion. Moving a paragraph should preserve an anchor inside it; an anchor at the old parent gap follows the gap's policy. Copying creates new occurrence identities. Splitting and joining require deterministic identity and offset rules. Undo must explicitly restore references where required; reversing offsets alone cannot recover information lost through deletion.

Resolution should distinguish an exact result, a policy-selected fallback, deletion and unavailable history. A caret may request a nearby valid location. A comment may remain orphaned. An agent replacement must not silently accept a nearby fallback.

Shared mapping machinery should serve selections, decorations, comments, bookmarks, history and collaboration. Consumers choose documented policies rather than implementing separate, inconsistent offset arithmetic.

## Durability and concurrency

For authority-based collaboration, submitted operations carry a confirmed base version and unique operation identity. The authority orders accepted operations. Clients rebase outstanding local edits and anchors through remote changes using the same deterministic structural rules. Agent edits can use this protocol too.

The required lifetime is the lifetime of the referenced range, including externally stored comment references. Insertions inside a comment range become part of it. Partial deletion shrinks the range without orphaning surviving content; deleting an original endpoint must not alone invalidate the entire range. Membership evolves through edits rather than requiring an original character to survive forever. Boundary insertions still use explicit endpoint association. Complete deletion has a distinct deleted/orphaned result, with undo restoration handled deliberately.

Reload, elapsed time and compaction must not invalidate a surviving range. Retain sufficient maps, stable identity/tombstone metadata or another proven resolution mechanism. Checkpointing only known comments is insufficient for old exported references. Unavailable remains a diagnosable failure for missing/corrupt/incompatible state, not a normal age-based expiry policy. The OT/Automerge experiment must prove this contract before the storage design is accepted.

A future CRDT implementation would need anchors backed by identities in its replicated sequence. Stable node keys plus numeric text offsets are not equivalent. Yjs illustrates both identity-relative positions and failure to resolve when the referenced type disappears. Do not promise that an OT anchor encoding can be translated losslessly into a later CRDT encoding. [Yjs relative-position API](https://docs.yjs.dev/api/relative-positions)

Expose versioned anchor creation, resolution and serialization now, with an explicit encoding kind. Keep backend-specific data opaque to extensions without hiding its lifetime or failure semantics.

## Agent edit preconditions

An edit proposal should contain a base version, durable target range, intended operation and expected target content or version. For structural edits, include relevant node attributes and structure in the precondition. Hashing only plain text would miss a formatting or structural conflict.

Resolve and rebase the target, then validate the precondition against the current state before committing. Return a conflict when the target changed incompatibly, was deleted or resolved only approximately. Define whether insertions inside the proposed range are conflicts. External edits outside that range may be safely rebased according to the operation's contract.

Repeated delivery of the same operation ID must not apply an agent edit twice. Mapping solves location; preconditions and operation semantics protect intent. Neither proves that two arbitrary edits commute.

## First implementation and proof

Implement snapshot points, structural gaps, resolution, mapping results and versioned durable anchors before building new marks and decorations on them. Exercise nested headings and paragraphs in lists and table cells.

Test boundary insertions with both associations; split/join; subtree move/wrap/unwrap; deletion and undo; copied identities; emoji boundaries; cross-container ranges; disjoint cell ranges; and old external references after reload and compaction. Test interior insertion, deleted original endpoints with surviving range content, map composition on surviving positions and explicit deletion outcomes on removed ranges.

For collaboration, use pairs of concurrent text and structural edits and verify agreed document and anchor outcomes after transformation. Include an agent proposal whose target changed and must conflict, one with an unrelated edit that can rebase, and repeated operation delivery. These are prerequisites for collaboration claims, not consequences of having serializable ranges.
