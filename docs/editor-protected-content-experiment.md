# Protected content: recipient-specific delivery

The experiment now exercises two ways to send a restricted document: projected JSON
updates and separately authorised Automerge partitions. Both reuse the core
`projectDocument` function. Restricted recipients receive an opaque block's stable
key, placement and lock flag, but no payload or descendant identities.

The subsequent [restricted-write experiment](editor-restricted-writes-experiment.md)
adds authority-admitted concurrent text proposals from these incomplete replicas.
Native concurrent Automerge writes remain separate.

This is a headless read-distribution proof under
`tests/experiments/collaboration/protected`. It is not connected to the demo or a
production network service. Run:

```sh
pnpm exec vitest run --project unit tests/collaboration-protected.test.ts
```

## Ownership and usage

The authority owns the canonical tree, document membership, access overrides,
comments, attachment content and current presence. The trusted host applies edits
which a write-admission layer has already accepted. A connection captures the
recipient's principal; requests cannot supply a different recipient identity.

```ts
const connection = authority.connect(principal, sendBytes);
const recipient = createProtectedRecipient(connection.session);

connection.requestAttachment(attachmentId); // Queues an ID, not content.
connection.flush(); // Authorises, encodes and sends now.
recipient.receive(deliveredBytes);
```

`sendBytes` is the final synchronous transport hand-off in this experiment. Tests
record those exact UTF-8 frames and pass the recorded bytes to the independent
recipient. There is no TCP/WebSocket server. A real transport must preserve the
same rule at its final write point: do not queue pre-authorised content and send it
after access has changed. Bytes already sent while access was valid cannot be
recalled.

Projection strips hidden subtrees before node codecs, outline extraction or
replication encoding run. Visible containers have their canonical children removed
from their payloads. The manifest separately describes permitted nesting. Its
sequence numbers belong to the recipient connection, not the canonical edit log.
An edit wholly inside a hidden subtree, with no other observable change, produces
no recipient frame or native change hash.

The modules own distinct parts of this proof:

- `authority.ts`: canonical projection, access decisions and final delivery.
- `partitions.ts`: native Automerge documents for individual permitted payloads.
- `wire.ts`: the experiment's parsed frame contract.
- `recipient.ts`: received payloads, native partition lifetime, cache invalidation
  and recovery after a delivery gap.

These are experimental modules, not new public editor packages or a universal
collaboration backend interface.

## JSON projection and native partitions

The JSON path sends full payloads only for changed visible blocks, plus the current
permitted manifest and auxiliary data. The recipient has no canonical operations,
history, position checkpoint or offsets through hidden text. A policy change sends
a fresh current projection.

The Automerge path keeps one native document per block payload for this proof.
It sends a snapshot for a newly readable partition and native changes for later
updates. A partition contains neither siblings nor canonical document history.
The authority's manifest is projected JSON in both paths; it is not a shared CRDT
which could retain the structure of hidden descendants.

Partitioning alone is insufficient for grants. An existing native snapshot can
contain deleted text from before the recipient had access. This experiment rotates
**all partition histories** on an access change or structural edit, then creates
new native documents from current allowed payloads. A newly granted reader thus
receives current content without protected-period versions. A reconnect/resync can
receive only the current access epoch's native history.

This is a deliberately coarse security-first prototype. It resends allowed data
and changes native identities, including for readers whose access did not change.
The test confirms that old heads are absent from the replacement partition even
when its text is identical. It does not solve durable native references, accepted
pending writes across epochs or atomic operations spanning partitions. Finer access
cohorts/epochs would need their own correctness and reference-lifetime proof.

## Auxiliary channels

Search runs against the recipient's received text only. Outlines are computed from
visible projected nodes. Presence inside or crossing a protected region is omitted
before encoding; a restricted sender also cannot publish a selection into it.
Closing a session removes its presence. Canonical edits clear transient presence
in this small experiment rather than claiming to rebase it.

Comments require both a readable current range and readable, explicitly supplied
`readKeys`. These are trusted disclosure scopes, retained on the authority and
never sent to a restricted recipient. They are independent of the comment's
current anchor positions. The movement test found why this matters: moving a
protected block out of a comment's range must not automatically declassify the
comment's text. Missing disclosure targets fail closed. Deriving and maintaining
these scopes in a real comment extension remains separate work; this is not
content-based data-loss prevention or an arbitrary extension permission system.

Attachment requests hold IDs until flush. The authority checks the attachment's
owning node immediately before sending its body. Missing and inaccessible requests
have the same response shape, containing only the caller-supplied ID and an
unavailable status. Payloads are small strings in this fixture, not a deployed
asset proxy. Real attachment URLs/CDN routes require the same authorisation;
removing a URL from an outline would not revoke an independently public asset.

## Revocation, delivery and reconnect

Revocation changes the access epoch. The next frame contains the new permitted
manifest, removes inaccessible payloads and clears the recipient's old native
replicas, auxiliary data and attachment cache. An attachment queued while readable
is unavailable if access is revoked before flush. A text edit prepared before
revocation but not yet sent is also excluded.

A recipient rejects old sequence numbers, old epochs and packets addressed to an
old connection. A gap in an incremental stream clears the replica and requests an
explicit current resync; it does not apply changes against a missing basis. Full
resyncs include only currently allowed content. Access-change frames are full
resets, so a revocation can invalidate cached state despite a prior delivery gap.

This covers cooperative caches owned by the experiment. It cannot erase snapshots
an application or hostile recipient retained while authorised, guarantee memory
zeroisation, or make a disconnected user forget previously delivered content.
Document-member removal and persistent browser/storage caches are not implemented.

## Evidence

The same scenarios run against both encodings:

- Initial nested protection, visible/read-only/protected readers, and an opaque
  container with no descendant payload, IDs, titles or text.
- Hidden-only edits, followed by ordinary visible updates.
- Current-state search, projected outlines, comment disclosure scopes and
  cross-region presence filtering.
- Guessed attachment IDs and revocation of queued attachment requests.
- Cache removal and late delivery of an older authorised frame.
- New grants after multiple private historical versions, reconnect, reordered
  updates and resync.
- Moving a protected container while preserving its opaque identity.

The audit reads serialized frames, loads their native snapshots, applies native
deltas and materializes every transmitted historical change. It also inspects
decoded operation values. Merely searching compressed bytes would miss secrets.
A negative control proves the audit finds a deleted sentinel in an unsafe native
snapshot whose current materialized content contains only public text.

The suite additionally confirms that rotating native history loses old native
heads. That is a measured semantic tradeoff, not a solved reference migration.

## Assessment and remaining gates

Recipient-specific projection meets the tested no-disclosure cases with either
encoding. The Automerge variant still needs an authority for membership, routing,
policy changes and manifest projection. Its access/history epochs add reference
and multi-partition transaction work. The JSON path keeps recipient payloads
independent of canonical history and is the simpler current prototype.

This strengthens the case for authority-projected delivery for our requirements;
it does not yet select the edit-concurrency algorithm. The trusted host drives
canonical edits here. Neither path is an end-to-end multiplayer editor with
restricted replicas making concurrent structural changes.

Text write admission from projected coordinates is now covered by the linked
restricted-write proof. Still outstanding: durable references
across access epochs, simultaneous permission and edit transactions, protected
inline spans/marks, arbitrary extension metadata, large-document projection cost,
network authentication/quotas, persistent caches and production asset delivery.
Node keys are assumed to be opaque public identifiers; callers must not put secret
content into them. Existence, placement and lock state are permitted metadata.
Traffic-analysis resistance is outside this proof.
