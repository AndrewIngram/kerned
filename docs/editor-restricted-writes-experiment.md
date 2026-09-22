# Text edits from restricted replicas

Restricted recipients can now propose text edits using their received block keys,
local UTF-16 offsets and last applied view sequence. The authority validates and
rebases those proposals without exposing canonical revisions, hidden lengths or
hidden edit operations. The same write path works with projected JSON delivery and
partitioned Automerge delivery.

This is an **authority write path in both modes**. It is not native concurrent
Automerge editing of the partitions, and it does not choose the production backend.
It remains headless and is not connected to `editor.html`.

```sh
pnpm exec vitest run --project unit tests/collaboration-restricted-writes.test.ts tests/collaboration-protected.test.ts
```

The subsequent [optimistic typing experiment](./editor-optimistic-collaboration-experiment.md)
adds a local queue and authorised visible edit mappings to projected frames. The
confirmed-only recipient below remains the lower-level delivery interface.

## Caller flow

```ts
const bytes = recipient.propose({ key, from, to, text });
const replyBytes = connection.submit(bytes);
const receipt = decodeReceipt(replyBytes);
connection.flush(); // Sends only that recipient's authorised projection.
```

The recipient constructs expected text from its own confirmed replica. It does not
receive the canonical document to prepare the proposal. Proposals and receipts
cross the UTF-8 wire parser. An accepted receipt contains only the caller's operation
number; the subsequent projected frame carries authorised current content.

The recipient currently changes its confirmed state only on received frames. It
has no optimistic rendering or queue for edits targeting newly typed, unconfirmed
text. Multiple independent proposals can use the same confirmed view. That suffices
to test concurrent write admission, but is not a finished typing experience.

## Canonical ownership and coordinate mapping

The new experimental `document.ts` module owns the canonical tree, text edit log,
per-session view bases and operation receipts. Both trusted host edits and submitted
client edits pass through its apply path, so hidden host changes cannot bypass the
coordinate history. A failed compound host edit leaves the old tree and log intact.
Structural changes clear the text log and rotate the access epoch; old proposals
then require a new view rather than guessing a mapping through a changed tree.

A connection records the text and private canonical revision associated with each
view it sends. The client names the last view it successfully applied. These are
recipient-specific sequence numbers: hidden-only edits do not advance them. The
server maps that view back to its private edit log and rebases by stable node key.
Edits in hidden nodes therefore do not change visible-node offsets or leak their
operation count in acknowledgements.

A view sequence proves that the authority sent that view to the connection, not
that a remote process acknowledged receiving it. The normal recipient only proposes
from applied frames. A missing/unknown base is rejected; a delivery gap clears the
recipient and prevents proposals until a current resync arrives.

Two possible shapes were considered. Publishing canonical revisions or filtered
canonical commits would couple the client to hidden history and risk disclosure.
Keeping a private mapping from recipient views to canonical revisions gives the
write module enough information without exposing that history. This is a bounded
experiment: the maps and journal are not yet compacted or persisted across restart.
Connection closure clears its bases and receipts; authority destruction closes all
connections. An uncertain send failure also closes the session, preventing a retry
from reusing the same view number for a different payload. Delivery state is reserved
before calling the transport: synchronous delivery may submit edits, flush again or
request resync without overwriting a view basis or losing the resync request.

## Admission and concurrency

The connection captures the principal and session. The server checks current
editable access before examining historical text. A missing, protected or read-only
target receives the same `denied` result. A proposal cannot choose another session,
name an unsent base, smuggle a different operation under an existing identity or
receive canonical text in a rejection.

The authority checks the expected substring and grapheme boundaries in the named
view, rebases across subsequent canonical text edits, then validates the exact
current text and boundaries again. It uses the existing conservative mapping:
acceptance order resolves equal-position insertion; ambiguous overlapping
replacement returns `conflict`. Inserting a combining mark can invalidate a former
boundary, so numerical rebasing alone is insufficient.

Receipts make retry idempotent. Retrying an accepted operation does not apply it
again. Retrying a denied operation after a later grant still returns its original
rejection. The user can issue a new operation from a current authorised view.
Changing the payload under an existing operation identity is rejected.

An access-epoch change invalidates unprocessed proposals even if the changed
permission was elsewhere. This is conservative. A current denial takes precedence
for a target which became inaccessible. Previously settled receipts contain no
content and can still be returned without reapplying the operation.

## Evidence

Both delivery modes exercise:

- Concurrent visible insertions while an owner edits a protected descendant.
- The same 225 replacement pairs: 135 accept both edits; 90 explicitly reject
  the overlapping second edit. Both readable views converge after delivery.
- Revocation while a proposal is outstanding, ancestor restrictions, guessed
  hidden/missing keys, read-only clients and later regrant.
- Duplicate requests, changed-payload retries, forged sessions/bases, invalid
  JSON and incorrect expected text.
- Combining-mark concurrency and revalidation after mapping.
- Structural epoch changes, reconnect, reordered view delivery and resync.

The existing protected-content wire audit is shared with this suite. It examines
serialized projections and native histories. Guest frames and receipt bytes are
checked for protected sentinels; canonical edit counts and rejected text never
appear in successful or rejected receipts. An uncertain-delivery regression proves
an old connection cannot keep editing under a reused view sequence.

## What remains

This proves that an authority can accept text edits from incomplete replicas while
preserving the tested disclosure rules. The Automerge mode is an outgoing encoding
for these tests; native CRDT write admission across protected partitions is still
unproved. Do not use these results to claim a CRDT concurrency comparison.

Optimistic local editing and acknowledgement/recovery are now covered by that
subsequent experiment. Remaining integration gates include durable references,
client structural commands around opaque blocks, collaborative undo and mounted
editor bindings. The previous experiment's native identity loss
on access-epoch rotation is unchanged. Transport authentication, quotas, persisted
receipts, large-document costs and production asset delivery are also outstanding.
