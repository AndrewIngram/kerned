# Permission rejection and recovery experiment

This milestone tests text-edit permission checks and recovery after denial for the
authority and Automerge candidates. It does not select a backend or add collaboration
to the mounted editor. The experiment stays under `tests/experiments/collaboration`.

```sh
pnpm exec vitest run --project unit tests/collaboration-permissions.test.ts tests/collaboration-authority.test.ts tests/collaboration-automerge.test.ts
```

## Admission

The existing authority prototype checks the target and its ancestors before
committing a proposal. A rejected proposal leaves its revision and position
checkpoint unchanged. The optimistic client removes the rejected edit and clears
its selection, then can submit a new allowed edit. A later permission grant does
not turn a retry of the rejected proposal into a new operation.

The new `createAutomergeAuthority` experiment owns an accepted CRDT document. The
host connects a principal with a fresh actor ID; messages cannot choose that
identity. Every submitted binary change must belong to that actor. Actor IDs
cannot be reused after disconnect, and an actor/sequence pair cannot name different
changes. This is a model of authenticated connection ownership, not authentication.

For the fixed-tree fixture, the gate knows which native text object belongs to
which node. It examines **every operation** in a change and checks the target node
and ancestors against current policy. Only text insertion/deletion operations are
admitted. Structural writes and marks are deliberately unsupported. Checking just
the final text would miss a forbidden insertion followed by a deletion in the same
change. The regression test also changes an allowed node in that transaction and
verifies that nothing is partially committed.

The gate applies eligible changes to a disposable clone, projects that clone
through the schema and transform engine, then replaces the accepted document.
Invalid changes leave the accepted state untouched. Rejected receipts are retained,
so retrying a denied change after a permission grant still returns the rejection.
Permission checks use current node content, not the initial snapshot.

A change with missing dependencies is deferred and **not applied or buffered in the
accepted CRDT**. It requires explicit resubmission after dependencies are accepted.
Otherwise an early change could be buffered under one policy and applied implicitly
when an unrelated submission supplied its dependencies after revocation. A retry
runs permission checks again. This experiment admits exactly one binary change per
message; it rejects batches rather than inventing partial batch semantics.

The host must broadcast only accepted changes. Allowing arbitrary peer-to-peer
changes to bypass this gate would defeat its policy. Load snapshots, permissions,
principal/actor registration and recovery instructions are trusted host inputs.
There are no payload quotas, durable receipt store, network protocol or production
security claims here. Object mappings assume the tree never changes.

## Recovery

A denied native change can be an ancestor of every later change from that actor.
Keeping those later binary changes will not recover editing. Reverting the visible
text on the same branch also leaves the forbidden history present.

The tested alternative is rebuilding from accepted history and reauthoring a
conservative subset of pending edit intents under a fresh host-issued actor:

```ts
const recovery = recoverAutomergeEdits({
  schema,
  nodes,
  generation,
  base: acceptedSnapshotBeforePendingEdits,
  seed: latestAcceptedSnapshot,
  actor: freshActor,
  pending,
  denied: deniedSequences,
});
// Each replayed outcome contains a new message that still needs admission.
// Replace the mounted state only through a future coordinated recovery flow.
```

The recovery module owns the replay decision and the new replica. A pending intent
contains its local sequence, target/edit and entire prior text. It is an ordered
journal from one accepted base, with no accepted prefix mixed into it. The caller
retains the original branch/journal for explicit conflict handling and destroys
replicas when finished.

Replay rules are intentionally conservative:

- Skip denied edits and subsequent edits to the same text node.
- Skip nodes touched by any accepted operation since the base, even if their final
  text is identical. Deleted and recreated characters have different identities.
- Require the entire prior text to match before replay, not only the replaced
  substring. Ambiguous coordinates must not silently target another occurrence.
- Replay independent edits sequentially into a new replica. A replayed edit is
  still a proposal: the authority checks current permissions before accepting it.

Outcomes distinguish `denied`, `dependency` and `changed-base`. They do not silently
approximate locations, force rejected changes through, or claim to preserve every
independent edit within the same node. Snapshot lineage must include the original
base. This recovery proof does not handle concurrent structural edits, accepted
pending prefixes, rejoining a live transport or multiple recovery epochs.

## References and presence

References captured from accepted history still resolve after recovery. References
captured on the rejected branch are not rewritten. That includes references into
later text which was successfully replayed: the replacement characters have new
native identities. The native wrapper also requires all captured heads, so even a
post-denial reference pointing into otherwise untouched text is conservatively
unavailable. The tests report `dependencies`, not a fabricated position.

This is a real unresolved requirement for externally stored comment ranges. An
application cannot simply rewrite every reference because some live outside the
editor. A production design must distinguish accepted references from tentative
references and define durable resolution across rejected branches, or restrict
when externally durable references can be published. This experiment makes neither
product choice.

Transient presence from a rejected branch must also be withdrawn and recaptured.
The authority client already clears selection on rejection; the Automerge tests
prove old cursor messages cannot resolve on the accepted/recovered branch. A live
presence membership update and mounted caret reset remain to be implemented.

## Result and limits

Both candidates can enforce read-only text nodes at a central authority, including
ancestor restrictions and permission revocation between authoring and submission.
Automerge can recover independent later text edits, but rejection requires more
than its native merge API, and reference identity becomes an explicit concern.
The authority prototype currently avoids that queue problem by allowing only one
pending proposal. It still needs a realistic queue/rebase recovery proof.

Protected-content projection is separate from edit permission. These replicas
contain the full readable fixture. No secret-content redaction has been proved.
Move/delete permissions and general node locking require structural operations;
this text-only gate does not redefine the user's policy that read-only nodes may
be moved or deleted unless locked. Mark-level permissions, collaborative undo,
restart-safe receipts and reference recovery are also outstanding.

The extra cloning/projection work in the Automerge gate has not been benchmarked.
The earlier comparison's numbers describe the previous ungated adapters only.
