# Two-client collaboration and presence

Status: acceptance plan. No networked collaboration or remote selection renderer
is implemented by this document. Presence is part of the two-client experiment,
alongside concurrent edits and durable comment references.

## What the first demonstration must show

Two independently mounted editors share a document through a controllable local
authority. Each can edit while seeing the other's caret or selection. Delaying,
duplicating and reordering delivery must exercise real synchronization behavior.
Copying the entire state between two views does not prove collaboration.

Remote selection rendering must support collapsed carets, backward selections,
multiline and cross-block ranges, nested content, bidi text and table-cell
selections. Preserve anchor and focus separately. A normalized comment range loses
the direction and caret endpoint needed to represent a user's selection.

Presence is transient extension state. It is absent from document JSON, durable
position checkpoints, clipboard content and undo history. A remote selection must
never become the local selection, steal focus or scroll the reader's viewport.
Receiving presence must not reshape text or reflow blocks.

## Ownership and interfaces

- The collaboration module owns confirmed authority version, pending local edits,
  operation identities, acknowledgements and conversion between coordinate spaces.
- A presence extension owns per-session participants, latest selection, expiry and
  subscriptions. Its interface should let applications publish local presence and
  consume remote presence without knowing the transport or requiring React.
- Selection types own their serializable selection representation. Core text and
  node selections use stable positions and keys. The table extension owns cell
  selection encoding and resolution; core must not acquire table-specific fields.
- The view projects resolved selections through existing layout geometry. Remote
  highlights and carets share the same bidi, line and viewport behavior as local
  selections. Decorations must support a collapsed caret, not only painted ranges.
- Applications supply permitted participant names and appearance. React supplies
  optional subscription hooks and custom labels; it does not own synchronization.

Existing in-memory selection bookmarks contain runtime node IDs and methods. Do
not send those objects over the wire. Design the serialized selection interface
against both core selections and the table extension before making it public.

## Coordinate and delivery contract

A document ID and local revision number alone are insufficient. Two clients can
reach revision 10 through different optimistic changes. A wire selection must name
the shared document generation and authority version, or carry the chosen CRDT
backend's stable anchor representation. The collaboration module must translate
between that shared basis and each client's pending edits.

For the authority experiment, start by publishing selections only once their
coordinate basis is acknowledged. Retain and coalesce the newest local selection
while edits are pending, then publish its translated position after acceptance or
rebase. Measure the visible delay. Do not silently project an unacknowledged local
offset onto an unrelated server revision. Selection transmission during pending
edits is a later optimization that needs an explicit dependency contract.

Use authenticated participant identity plus a fresh session identity for each
connection. Multiple tabs belonging to one user are independent sessions. Each
session sends a monotonically increasing presence sequence; an older message
cannot replace a newer selection or revive a departed session. Define the session
generation and retirement rules at the authority so reconnects cannot resurrect
stale cursors. Presence may travel separately from document updates.

Defer a selection whose required document update has not arrived. Bound pending
messages per session and replace older ones with the newest. If its document
generation is wrong, discard it. If its target was deleted, hide the selection
until a newer valid update arrives. Do not invent a nearest visible location.
Expire disconnected sessions using receiver/authority time, with explicit leave
messages for prompt removal. Sender clocks are not trusted for ordering or expiry.

The transport must coalesce pointer/keyboard updates and keep queued presence
bounded when disconnected. Persisted edit retries and transient presence delivery
have different reliability requirements.

## Permissions

The authority filters presence for each recipient before transmission. An
unauthorized recipient must not receive protected text, internal offsets, hidden
node identities, selection lengths or labels derived from hidden content.
Selections crossing protected content need an explicit permitted projection;
until that projection is defined, omit that selection. Do not transmit it and rely
on the renderer to hide it. Revalidate pending presence after access changes and
clear prior application-controlled presence caches on revocation.

## Acceptance scenarios

1. Alice inserts before Bob's selection; Bob's range follows the surviving text.
   Insertions within a remote range follow its documented endpoint associations.
2. Both clients type before acknowledgement; a selection arriving before its edit
   is deferred and later resolves correctly. Equal local revision numbers do not
   falsely imply a shared state.
3. Backward, multiline, RTL and rectangular cell selections preserve their focus
   endpoint and visual shape through remote changes and split/join operations.
4. Duplicate/reordered presence, explicit leave, timeout and reconnect never
   restore a stale cursor. Two tabs of one account remain distinct.
5. Remote presence neither changes local selection nor adds an undo entry. Local
   undo after remote edits preserves remote content under the chosen undo policy.
6. Deleted, unloaded and protected targets have distinct outcomes. Authorized but
   unloaded targets can remain unresolved until layout is available; protected
   targets are filtered before delivery.
7. Inspect outgoing payloads and caches for a protected sentinel, including after
   revocation. A rendering-only assertion is insufficient.
8. Measure update rate, queue size, resolution/paint cost and layout work with
   selections in a large document. Presence traffic must not trigger whole-document
   layout or retain an unbounded revision backlog.

Run these against the provisional authority/rebase and Automerge experiments
before choosing the production backend. Do not impose the current local position
checkpoint format as a universal collaboration wire protocol.

When the headless contract is proven, choose the demo's cursor labels, colors and
participant controls through the UI exploration process. That visual choice does
not block the synchronization tests above.
