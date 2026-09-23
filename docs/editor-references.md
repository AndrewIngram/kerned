# Positions, external ranges and persistence

Implemented 2026-09-20. The former registered-range design has been removed. A range is a serializable pair of endpoints; there is no range ID, registration call or document-owned list of comments.

## External values

```ts
const range = editor.positions.range(
  editor.positions.at(headingId, 2, 1),
  editor.positions.at(lastParagraphId, 12, -1),
);
const saved = JSON.stringify(range);
const result = editor.positions.resolveRange(parseRelativeRange(JSON.parse(saved)));
```

Each endpoint contains `{version, documentId, revision, key, offset, association}`. Keys identify node occurrences; offsets are grapheme-safe UTF-16 boundaries at the captured revision. Both endpoints belong to the same document revision. Callers can decode or construct these values without registering them. Creating ten thousand ranges does not alter document state, undo grouping or persisted position metadata.

Association `-1` stays before text inserted at an endpoint, and `1` follows it. A start association of `1` and end of `-1` exclude insertions exactly at the edges. Use `-1`/`1` to include them. Interior inserted text and new text blocks between the endpoints are included. A collapsed range needs deliberate association choices; use a single relative position for a caret.

Resolution returns node-local text intervals, suitable for canvas geometry. It follows split, join, movement, wrapping, unwrapping and deletion. If an endpoint block disappears, range resolution uses surviving text on the interior side first. Partial deletion preserves the surviving range. Complete deletion or complete text replacement returns `deleted`; local undo restores pre-existing references. An array of ranges represents a disjoint selection such as selected table cells. A single range stays contiguous between its endpoints; it does not follow a disconnected bag of text when content is reordered.

Unavailable results distinguish another document, a future revision and missing historical metadata. Snapshot positions remain a separate API: `createPositionSnapshot` provides tree context, child gaps and explicit transition mapping, but its handles are not serialized durable values. Durable structural gaps are implemented below; permission-aware reference resolution remains outstanding.

## What is persisted

```ts
const saved = {
  documentId: editor.documentId,
  revision: editor.state.revision,
  nodes: editor.state.nodes,
  positions: editor.positions.checkpoint(),
};
const restored = createEditor({
  schema,
  document: saved.nodes,
  selection,
  documentId: saved.documentId,
  revision: saved.revision,
  positionCheckpoint: saved.positions,
});
```

This checkpoint contains **document change metadata**, independent of whether any external references exist. It retains text mappings, structural deletion fallback boundaries, and operation/undo relationships. It does not contain ranges, comment IDs, historical document snapshots or comment messages. Save it consistently with the document revision. Comments and other external references can live in separate storage and require no rewriting when text changes.

`compactJournal()` discards the legacy journal used by `createAnchor`/`resolveAnchor`. It does **not** discard the retained position mappings. That distinction matters: this owned authority/OT candidate currently buys reference durability with history-dependent metadata. Checkpoint size and old-reference resolution cost grow with edits. It is not a CRDT identity implementation, a bounded compaction algorithm or a production collaboration backend. Loading document text without its position checkpoint cannot reconstruct old references.

Undo and redo retain operation identities so a mapping and its undo can cancel for older external endpoints, without knowing which endpoints exist. This is tested against local history, including grouped edits and references created between edit and undo. Remote-history rebasing remains unimplemented. Undo stacks themselves are not included in the position checkpoint.

## Cost and validation

The measurements below are the original reference-lookup study, not fresh timings
for the current package build. See [current limitations](editor-limitations.md)
for the remaining retention and long-session validation work.

Normal dispatch retains owned mapping records without JSON/WASM serialization or visiting external ranges. Resolution lazily indexes the current tree and caches grapheme boundaries by immutable node. Shared mapping summaries skip safe sections, combine offset shifts and serve different capture revisions. Undo cancellation remains capture-revision-aware. Ambiguous cases use exact replay with chunk summaries and a bounded suffix cache. None of these caches registers ranges.

See the [performance report](relative-position-performance.md) for the algorithm, regression budget and measured limits. The original 1,000-range / 10,000-edit workload now resolves in a 3.0 ms median including index construction, compared with about 120 ms before. Different capture revisions and undo/redo are also covered. The checkpoint remains 1,426,801 bytes at 10,000 edits; faster lookup does not compact persisted history or guarantee constant-time resolution for arbitrary structural histories.

The public-core tests cover external values, checkpoint reload, deletion of both original endpoint blocks with surviving interior content, split/move/join, newly inserted interior blocks, associations, disjoint cells, undo/redo, malformed checkpoints and atomic rejection. The benchmark also asserts that creating references does not change stored metadata.

## Durable structural gaps

`editor.positions.gap(parentId, childIndex, association)`, `before(nodeId)` and `after(nodeId)` capture standalone `RelativeGap` values. Parse external JSON using `parseRelativeGap` and resolve it with `resolveGap`. Values contain the document identity, parent key and neighboring child keys, never runtime IDs or a registered range ID. They can resolve after reload without text-edit metadata if the document keeps its durable keys.

Association `1` prefers the following child's leading edge; `-1` prefers the preceding child's trailing edge. The preferred edge follows its node through moves, wrapping and unwrapping. If it is deleted, resolution uses the surviving other edge. If both disappear, the result is `deleted`; undo can restore resolution. An originally empty-container gap follows that container's beginning or end as children arrive. A different document returns `unavailable`.

These are identity-attached structural references, not historical child indexes. They deliberately do not claim to recover a gap after both defining edges have been deleted, even if other children now occupy the container. Text comment ranges continue to use the existing revision-aware relative endpoints, including interior expansion and partial deletion semantics. Never reuse a deleted durable key for unrelated content.

Snapshot gap transformation now uses public `mapGapPosition`; text selection and snapshot transformation continue to share `mapPosition`. Durable text references retain the undo-aware mapping index. The coordinate kernels are shared, but interactive selection recovery and orphaned external-reference handling remain separate policies.
