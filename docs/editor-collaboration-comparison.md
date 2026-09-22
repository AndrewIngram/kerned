# Authority and Automerge: first comparison

This is a text replication and position-semantics comparison, not a production
backend selection. Both candidates use the same assembled schema, stable node keys,
UTF-16 edit offsets and grapheme validation. Neither is connected to `editor.html`.
The Automerge dependency is pinned to 3.5.0 in root devDependencies only.

Run the shared cases:

```sh
pnpm exec vitest run --project unit tests/collaboration-authority.test.ts tests/collaboration-automerge.test.ts
node scripts/benchmark-collaboration.mjs
```

## What the tests establish

| Scenario                                                           | Authority prototype                                                                 | Automerge prototype                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Same-position concurrent insertion                                 | Authority acceptance order                                                          | Native deterministic ordering; fixed actors in the fixture produce a different order                    |
| 225 concurrent replacement pairs on `abcd`                         | Both edits accepted in 135 cases; second edit explicitly rejected for overlap in 90 | All 225 merge; both inserted strings survive                                                            |
| Overlapping replacement                                            | Conflict returned to the author                                                     | Merged text; convergence does not establish intended wording                                            |
| Independent runtime node IDs                                       | Stable keys identify wire targets                                                   | Stable keys identify CRDT text fields                                                                   |
| Duplicate and reordered operations                                 | Versions, receipts and bounded commit buffer                                        | Duplicate changes idempotent; missing dependencies defer application                                    |
| Several local edits before delivery                                | Explicitly unsupported: one pending proposal                                        | Supported in this experiment; later change can arrive first                                             |
| Backward cross-block selection, nested Arabic/Chinese              | Anchor/head survive rebasing                                                        | Anchor/head cursors resolve against stable text keys                                                    |
| Selection created before text delivery                             | Confirmed-version presence waits for commits                                        | Heads travel with cursor; resolution waits for dependencies                                             |
| Emoji, combining marks, regional indicators                        | Validate proposals and rebased offsets; snap displayed presence                     | Validate local input; merge character operations; snap displayed cursors                                |
| Insertion at a referenced boundary                                 | Explicit insertion association                                                      | Native deletion fallback bias is **not** our insertion association                                      |
| Referenced character deleted                                       | Presence endpoint may become unavailable                                            | Native cursor falls back to remaining text                                                              |
| External range after save/load, insertion inside it                | Not demonstrated across collaborative rebases                                       | JSON cursor pair survives binary save/load and expands across interior insertion; no range registration |
| Expiry, reconnect, departure, revocation, stale presence snapshots | Tested in authority membership/transport proof                                      | Not implemented or tested in the Automerge adapter                                                      |
| Edit permission rejection                                          | Authority checks target and ancestors before commit                                 | Fixed-tree text gate now checks every operation; rejected branches need explicit recovery               |
| Protected-content redaction                                        | Later JSON projection proof covers bounded restricted delivery                      | Later partition/epoch proof covers bounded restricted delivery; native identities change                |

The two suites share the actual replacement generator, not separately copied case
lists. The grid covers all endpoint pairs in one short ASCII string with fixed
replacement values; it is not an exhaustive convergence or intent-preservation proof.
The Unicode and nested-document cases add coverage outside that grid.

Native cursor capture is deliberately exposed as a candidate-specific operation.
For `ab`, both native biases captured at offset 1 resolve to offset 2 after an
insertion there. Our backward insertion association requires offset 1. At the end
of the string a native end cursor follows appended content even with backward
bias. Treating `getCursor(..., 'before')` as our `association: -1` would silently
break range semantics. The adapter's `snap` field only chooses a valid grapheme
boundary for display; it does not repair that semantic mismatch.

Our experiment captures numeric start positions, which follow the original first
character when text is prepended. Automerge also offers a special `start` sentinel
that remains at zero. Choosing between sentinels and character-relative cursors
belongs in a future editor-position adapter, with tests for both endpoint biases,
complete deletion, reinsertion and reference lifetime.

The subsequent [protected-content experiment](editor-protected-content-experiment.md)
tests recipient-specific delivery and native-history disclosure. Its write path is
still a trusted host, not the full concurrent editor.

## Integration shape and limits

`tests/experiments/collaboration/automerge.ts` owns a CRDT map from stable node keys
to collaborative strings. The initial tree remains in the editor model. Text
changes project into the real transform engine using whole-field replacements.
This preserves the fixture's nesting and runtime IDs, but does **not** replicate
structural editing or preserve marks through fine-grained patches. Those are
explicit next gates; whole-field projection is not a proposed hot path.

The adapter accepts changes produced by trusted fixture peers. It is not a
validated network ingress, mounted editor binding or recoverable
malformed-input handler. Native binary save/load and cursor resolution are used
directly. No generic collaboration-backend interface has been introduced: the
candidates have genuinely different coordinate, rejection and persistence models.
Publishing a common interface now would hide unresolved requirements.

Automerge is WASM-backed. This comparison adds a potential replication dependency,
not a new text-layout dependency. The measurements below do not isolate its WASM
boundary from native processing or our own projection work.

Presence remains transient. Capturing cursors does not change the serialized CRDT
document. The library's repository package has an ephemeral-message facility, but
we have not installed it or claimed its membership/lifecycle behavior. Before a
full presence comparison, run expiry, reconnect, revocation and stale-snapshot cases
through an Automerge-backed transport and recipient filter.

A raw-change permission probe makes one forbidden edit, followed by an allowed
edit from the same actor. Delivering only the latter leaves it pending because it
depends on the forbidden change. Delivering the forbidden dependency applies both.
This disproves a naive filter, not the possibility of an authorized Automerge
architecture. Restricted replicas, rejection recovery and protected-content
partitioning need a separate design and adversarial tests. The subsequent
[permission/recovery experiment](editor-collaboration-permissions.md) adds a central
text-only admission gate and conservative replay of independent pending intents. The authority prototype
also has no confidential replica projection yet.

## Measurements

Recorded on Apple M4 Pro, Node v24.21.0; see the committed
[raw measurements](../artifacts/collaboration-comparison/measurements.json) for the
actual environment, trials and full methodology. Rerunning overwrites that file.

| Immediately acknowledged replacements | Authority adapter median | Automerge adapter median |
| ------------------------------------- | -----------------------: | -----------------------: |
| 100                                   |            31.0 ms total |            44.8 ms total |
| 1,000                                 |           300.2 ms total |           521.5 ms total |

These are unoptimized **whole-adapter** costs on one 1,024-code-unit block, not
comparable backend microbenchmarks. Authority includes a proposal, server validation
and two client deliveries. Automerge includes a local change and one peer delivery,
with whole-text editor projection. Execution order is fixed and trials are serial.
No network, rendering, startup, cursor resolution or save time is included.
There is no evidence here about large documents or UI latency under concurrency.

For 1,000 edits, the authority experiment counts 397,355 bytes across three JSON
messages per operation; Automerge counts 110,871 raw binary change bytes sent once,
excluding its envelope. Different topology and encoding prevent interpreting this
as a fair compression ratio. The very small Automerge save size (265–270 bytes)
comes from this highly repetitive fixture. The 35,812-byte authority position
checkpoint is a different artifact, excluding the document, receipts and snapshots.
Neither figure measures live memory, and JavaScript heap alone would omit WASM memory.

## Assessment and next gates

Automerge demonstrates useful behavior we would otherwise build: native causal
replication, multiple unacknowledged edits and serializable character references.
It also leaves editor semantics and policy work: cursor association, intent after
concurrent replacement, structural schema validity, marks, collaborative undo and
restricted access. The conservative authority experiment has a straightforward
rejection point, but is far from a complete OT implementation or offline client.

Do not choose a backend from these numbers or from convergence alone. The next
comparison should target the hardest requirements: tree/mark operations with
durable external ranges, and permission rejection/recovery. Queued local edits
are also necessary to make the authority client representative. Mounted remote
selections come after a transport-independent presence lifecycle and geometry
adapter are agreed; no public API should expose either experiment's internals.

## Primary references

- [Automerge text editing](https://automerge.org/docs/reference/documents/text/)
- [UTF-16 splice offsets](https://automerge.org/automerge/api-docs/js/functions/splice.html)
- [Native cursor and deletion fallback semantics](https://automerge.org/automerge/api-docs/js/functions/getCursor.html)
- [Resolving cursors](https://automerge.org/automerge/api-docs/js/functions/getCursorPosition.html)
- [Applying changes and missing dependencies](https://automerge.org/automerge/api-docs/js/functions/applyChanges.html)
- [Checking historical heads](https://automerge.org/automerge/api-docs/js/functions/hasHeads.html)
- [Repository ephemeral messages](https://automerge.org/docs/reference/repositories/ephemeral/)
- [Authority experiment](editor-collaboration-experiment.md)
