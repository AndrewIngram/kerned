# Optimistic typing from restricted replicas

The headless protected-content experiment now accepts continued local typing while
an earlier edit awaits confirmation. `createOptimisticRecipient` owns the confirmed
projection, ordered drafts, one immutable request in flight and recovery results.
Both JSON and partitioned Automerge delivery use this client with the same authority
text-admission path. This is not native concurrent Automerge writing and is not yet
connected to the mounted editor or `editor.html`.

```ts
const client = createOptimisticRecipient(connection.session);
client.receive(initialFrame);
const draft = client.edit({ key: 'paragraph-key', from: 0, to: 0, text: 'Hello' });
client.edit({ key: 'paragraph-key', from: 5, to: 5, text: ' world' });
client.text('paragraph-key'); // Local text includes both drafts immediately.
const bytes = client.request(); // First request, or the exact same request on retry.
if (bytes) connection.submit(bytes);
// connection.flush() delivers a frame to client.receive(...).
// After that frame settles the first request, request() prepares the next draft.
client.takeResults(); // Draft IDs with confirmation or an explicit discard reason.
```

The host chooses transport and flush scheduling. The client does not call the
transport. Further drafts use the text the user sees, including earlier local
insertions and deletions. A returned request is a defensive byte copy; changes to
that copy cannot alter retry identity. Only one request is in flight at once.
Independent typing is not blocked, but network throughput still depends on round
trips. There is no persistent offline queue.

## Confirmation belongs to a document view

A standalone accepted receipt cannot tell the client whether a received document
view already contains its edit. The projection now includes the recipient's own
settled receipts and an ordered journal of visible text edits since its preceding
view. An own accepted edit carries the recipient's operation number; other edits
carry no author or operation identity. A projected frame atomically supplies both
the document state and the information needed to reconcile the queue.

Lost standalone replies therefore do not block confirmation. Retrying an immutable
request cannot apply it twice. Duplicate and older frames are ignored by the
existing recipient. Rejected operations trigger a delivery even if the document
itself has not changed, allowing the queue to settle without inventing an edit.

The authority's journal remains private. Delivery includes only changes to blocks
readable in both the previous and current view, within the same access epoch. All
policy or structural changes start a new epoch and send a full projection with no
edit journal. A newly authorised reader receives no previously hidden text history.
Hidden edits contribute no entries or canonical revision numbers to that journal.
Receipts disclose only that recipient's operation number and outcome, never rejected
text, hidden block keys or canonical revision counts.

This adds deliberately authorised visible history to the wire: a reader may receive
intermediate text inserted and deleted while continuously authorised. Comparing
snapshots alone would miss those edits and incorrectly accept delete/reinsert
(ABA) as unchanged text identity. The journal preserves that distinction.

## Rebasing and recovery

Remote edits are mapped through queued local edits, and local edits are mapped over
remote edits, using the same conservative overlap rules as authority admission.
Equal-position insertion follows authority acceptance order. Confirming the head
removes its optimistic overlay; dependent tail coordinates already include it and
remain valid. All remaining drafts are checked against confirmed text and grapheme
boundaries after reconciliation.

An ambiguous overlap drops the conflicting draft and later drafts in the same
block. Earlier valid drafts and drafts in other blocks survive. Rejection of the
in-flight head drops its same-block dependants. Recovery results identify draft IDs
and reasons (`conflict`, `precondition`, `rejected`, `reset`); they retain no draft
text. A dropped overlay is not a server-side cancellation: a request already sent
may still settle, and its original bytes remain the only retry until settlement.

A full resync or any access/structural epoch change conservatively discards the
unconfirmed queue, including drafts in unaffected blocks. An accepted head named
in that full frame is reported as confirmed; its unconfirmed tail is discarded.
A delivery gap clears local content and drafts until resync. The client does not
automatically replay drafts after reconnect or a later permission grant. A sent
request whose outcome was unknown at the gap may already be committed; the resynced
projection is authoritative. Old frames cannot restore the discarded overlay.

Revocation removes the confirmed protected content and optimistic text together.
Recovery records contain IDs and reasons only. As with the earlier read proof,
this cannot erase copies a hostile client made while authorised.

## Evidence and limits

Run the new integration suite with:

```sh
pnpm exec vitest run --project unit tests/collaboration-optimistic.test.ts
```

Tests cover dependent insertion/deletion, retry byte identity, duplicate delivery,
remote edits before and after acceptance, all 225 replacement pairs with queued
typing, head preservation when only a tail conflicts, independent-block recovery,
revocation/regrant, delivery gaps, full resync, visible ABA changes, hidden-history
wire auditing, combining marks, emoji and Arabic text.

This remains a correctness experiment. Text reads and draft validation currently
copy the projected text map and replay the queue. Server view bases, receipts and
journals have no persistence or compaction. There are no quotas or large-document
performance claims. The client does not yet map a mounted selection, IME composition,
comments, durable ranges, structural commands or collaborative undo. Those require
integration work before exposing a production collaboration extension. Native
Automerge partition identity still changes on access-epoch rotation; this milestone
does not resolve that backend question.
