# Compact position checkpoints

`editor.positions.checkpoint()` now produces version 2. Pass its JSON value back
as `positionCheckpoint` when reopening the matching document ID and revision.
The loader still accepts version 1 and migrates it on the next save. Reference
objects and their revision semantics are unchanged. Older editor versions that
only understand version 1 cannot read the new checkpoints.

The serializable `PositionCheckpoint` return type is exported from both
`@kerned/state` and `@kerned/core`. Consumers can wrap the checkpoint API and emit
TypeScript declarations without referencing a private implementation module.

Applications should persist this value as a unit, alongside the corresponding
document snapshot. Do not edit its internal records or use it as a collaboration
wire protocol. It contains document mapping history, not a registry of external
comments or ranges.

## Representation

The codec owns the persisted format; the resolver continues to work with named
mapping fields. Common text mappings use numeric tuples and an interned node-key
table. A definition is `[operationId, maps]`. Text mappings are:

- Replace: `[0, keyIndex, from, to, insertedLength]`.
- Split: `[1, keyIndex, at, rightKeyIndex]`.
- Join: `[2, keyIndex, at, rightKeyIndex]`.

Structural insertion/removal mappings retain their named fields, including
deletion fallbacks and structural boundary neighbors. They are cloned into the
checkpoint so caller mutation cannot corrupt the live position index.

An event is `[revision, signedOperationIds]`. Positive IDs apply their definition;
negative IDs undo it. Operation IDs are positive revision numbers, so zero is
invalid. JavaScript safe integers are preserved without 32-bit coercion.

The loader validates tuple shapes, tags, key references, integer bounds and map
ranges. The position index then validates document/revision identity, unique
definitions, ordered events, original operation membership and undo sequencing.
No input checkpoint can bypass those semantic checks by using version 2.

## Why this change

Dropping old maps would break unknown externally stored references. Coalescing
maps across revisions would also lose references captured between those edits
unless we retained an equivalent translation. This change instead removes
repeated JSON field names and repeated text-node keys without removing any
history. It keeps save/load compression out of typing and layout.

Packing the live mapping store into typed arrays is a separate investigation.
It needs retained-memory and reference-resolution measurements, including cache
construction, to avoid trading fewer stored objects for repeated decoding on the
lookup path. This checkpoint change does not claim that improvement.

## Measurement and verification

Run `RETENTION_REPORT=artifacts/editor-position-checkpoint-retention.json pnpm run
benchmark:session-retention`. Each isolated process checks old reference
resolution, JSON save/reload, and undo/redo where enabled. The report includes
save and load timings as well as retained heap and serialized byte size.

For 5,000 appended characters, the checkpoint fell from 734,618 bytes to 199,633
bytes, a 73% reduction. Both formats retain 5,000 definitions and events. Live
heap remains about 3.45 MB without undo and 4.18 MB with a single typing group;
the codec does not change live retention. These figures are for this local text
workload, not a structural-edit or collaborative workload budget.

See the [previous retention report](editor-session-retention.md) and the
[raw checkpoint measurements](../artifacts/editor-position-checkpoint-retention.json).
Tests cover all mapping variants, legacy migration through the public editor,
malformed data, detached snapshots and integer precision. The slow range replay
oracle decodes the format independently of the production codec.

Storage still grows linearly with edits. Bounded memory and collaboration-safe
compaction remain open work, with the requirement that surviving external ranges
do not expire merely because they are old.
