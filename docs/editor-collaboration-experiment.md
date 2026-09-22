# Authority and presence experiment

The first disposable headless experiment lives in
`tests/experiments/collaboration`. It uses independent imperative editor sessions,
the assembled schema and the actual text transform engine. It does not replace
client documents with an authority snapshot after each edit. Delivered commits
contain operations, stable node keys and authority versions.

Run `pnpm exec vitest run --project unit tests/collaboration-authority.test.ts`.

## Shape and ownership

The authority owns the canonical session, monotonically ordered commits,
authenticated-session handles supplied by the test host, operation receipts and
presence membership. `connect(principal)` returns a connection whose methods
capture that identity; proposals cannot choose another participant's identity.
This models the boundary behind a future authenticated transport. It does not
implement authentication itself.

Each client owns a confirmed editor and a separate optimistic proposal. The
confirmed version only advances after contiguous authority commits arrive. A
bounded buffer handles reordered commits; a gap larger than 64 requires a new
synchronization. Duplicate versions must have the same operation content.
Runtime node IDs deliberately differ between the authority and both clients.

The protocol module owns wire schemas and text mapping rules. Parse JSON messages
with its parsers at transport ingress; connection/client methods accept those
parsed values. The test transport round-trips representative messages through JSON.
These interfaces are experimental and are not exported by a public package.

The usage is intentionally small:

```ts
const proposal = alice.propose(edit);
const receipt = aliceConnection.submit(proposal);
// Deliver accepted commits independently to each client, in any order.
if (receipt.kind === 'accepted') {
  bob.receive(receipt.commit);
  alice.receive(receipt.commit);
} else {
  alice.reject(receipt);
}

alice.select(selection);
const packet = alice.presence();
if (packet) aliceConnection.presence(packet);
bob.receivePresence(bobConnection.readPresence());
const selections = bob.remoteSelections();
```

The executable tests handle rejected receipts and a null presence packet while
an edit is pending. Applications would not manually coordinate these steps;
the experiment exposes delivery so tests can delay and reorder it.

## Rebase policy

A proposal names its base authority version and the text it expects to replace.
The authority validates coordinates and grapheme boundaries in that original
snapshot, rebases across accepted edits, then checks current text and permissions
before applying. Same-position insertions keep authority acceptance order.
Disjoint replacements can rebase. Overlapping replacements and insertions inside
a concurrently replaced range return an explicit conflict.

An operation sequence belongs to one session. Retry returns the recorded result,
including a recorded rejection. Reusing its identity for different content is an
error. Equality compares fields, so JSON object property order cannot turn a valid
retry into a conflict.

The separation of confirmed version and pending edits follows the useful pattern
in [ProseMirror's collaboration implementation](https://github.com/ProseMirror/prosemirror-collab/blob/master/src/collab.ts).
This prototype's conservative replacement mapping is not a full implementation
of ProseMirror rebasing or a claim of general OT convergence.

## Presence

Presence keeps anchor and head, including their individual associations. A client
can update its local selection while waiting for an edit acknowledgement, but
does not publish those optimistic coordinates. Once acknowledged, it sends the
latest selection against the confirmed version. Receivers map through subsequent
commits and their own optimistic edit. Future-version selections wait for the
missing commits; deleted endpoints hide the selection.

The authority sends complete, recipient-specific presence snapshots with a
monotonic snapshot sequence. This gives departure and revocation a concrete
removal message. An older snapshot cannot resurrect removed selections. Each
sender also has a presence sequence, so stale updates do not renew its lease.
Both authority and receiver expire presence using local receipt time. Reconnecting
creates a new session identity, including for another tab of the same account.

Presence reads and writes do not modify editor selection, position checkpoints
or undo history. Remote selections are data for a future decoration/view adapter;
no drawing or layout integration is implemented here.

The authority omits selections that cross restricted content, checking selected
nodes, intermediate nodes and ancestors. This demonstrates presence filtering
only. Clients in this experiment start with readable document snapshots; full
protected-document projection and redacted operation delivery are not implemented.
Do not deploy it as a confidential document-sharing system.

## Evidence and limits

The suite exercises same-position inserts, 225 pairs of replacements, runtime-ID
independence, retries with changed content, reordered commits and presence,
pending/future versions, backward selections, nested cross-block Arabic/Chinese
selections, grapheme rejection, permission revocation, expiry and reconnects.

This first proof intentionally permits only one outstanding proposal per client.
Additional typing raises an explicit waiting error. It retains snapshots and
operation receipts without compaction. It has no mounted views, network transport,
marks, structural operations, cell selections, collaborative undo, offline/restart
recovery or durable external references across rebases. The prototype is not wired
into `editor.html`.

Two shapes were considered. Rebasing directly inside a mounted session would
need a correct rollback/replay transaction and history contract immediately.
Separating a confirmed session from an optimistic draft makes the coordinate and
delivery proof inspectable without changing the production API. The latter is
appropriate for this disposable experiment; rebuilding the optimistic draft on
read is not a proposed rendering hot path.

The next gates are queued local edits and rejection recovery, then structural and
mark semantics, durable references, collaborative undo and the corresponding
Automerge comparison. The selection protocol must also accommodate node and
extension-owned cell selections before publication. Choose the production backend
only after those gates, as required by the implementation plan. Visible remote
carets and labels require the separate UI exploration step.
