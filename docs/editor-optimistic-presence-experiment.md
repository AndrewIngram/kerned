# Selections and presence through optimistic edits

The experimental implementation now lives in `packages/collaboration-lab`.
A separate [mounted collaboration demo](editor-collaboration-demo.md) exercises
text editing, presence and protected projections at `/collaboration.html`.

The restricted optimistic client now owns a local text selection and derives remote
selections in the text currently shown to the user. Selection mapping uses block
keys, UTF-16 offsets and insertion association, preserving anchor/head orientation.
This remains a headless experiment using authority text admission with JSON or
partitioned Automerge delivery. No mounted editor bindings or native CRDT writes
are introduced.

```ts
client.select({
  anchor: { key, offset: 4, association: 1 },
  head: { key, offset: 2, association: -1 },
});
client.edit({ key, from: 0, to: 0, text: 'Hello ' });
client.selection; // Mapped in local text, including queued drafts.
client.remoteSelections(); // Peer selections mapped through that same queue.
const packet = client.presence();
if (packet) connection.presence(packet);
```

`select` accepts a selection in the current local text; it validates grapheme
boundaries and the readable range and copies the supplied value. Selection getters
return copies. Read-only participants can select and share presence. Text selection
ranges crossing an opaque subtree are rejected; opaque node selection is outside
this experiment.

`edit` maps an existing selection using each endpoint's association. It does not
implement a typing command's decision to collapse a selected range; that belongs
to the eventual editing integration. Confirmation removes the optimistic overlay
without mapping the selection a second time. Remote edits are mapped through the
local queue before they move the local selection. A late acceptance of a previously
discarded overlay behaves as a remote edit relative to newer drafts and selections.

## Three coordinate spaces

The caller only supplies local text coordinates. The client and authority own the
other mappings:

1. The client reverses pending edits to express presence in its last confirmed view.
2. A presence packet names the connection's session, access epoch, applied view
   sequence and a monotonically increasing presence sequence.
3. The authority uses its private view-to-revision mapping to move that selection
   into current canonical text. It validates the original endpoints in the named
   view and checks the sender's current read access before historical mapping.
4. Published presence is mapped over accepted edits at the authority. Each delivery
   includes only ranges readable by its recipient, alongside that recipient's
   current projected content.
5. A receiving client maps those confirmed peer selections through its pending
   queue for display.

An endpoint strictly inside newly inserted local text has no confirmed position.
The client sends an explicit null selection, hiding its previous presence until the
insertion is confirmed. Inserted-text and deleted-text boundaries use endpoint
association to choose a meaningful confirmed edge. If the reverse mapping produces
an invalid grapheme boundary, presence is hidden rather than approximated.

The old protected experiment's raw canonical-coordinate presence entry point was
replaced with the versioned byte packet. Callers cannot bypass the view mapping by
passing an unversioned selection. Duplicate/reordered presence packets, wrong
sessions, unknown bases and old epochs are rejected. Failed validation does not
advance the presence sequence. A valid null packet clears presence. Presence
sequence numbers do not expose document revisions or hidden edit counts.

## Recovery and privacy

When a conflicting or invalid draft is discarded, the client clears a local
selection with either endpoint in that block. Selections in unrelated blocks
survive. This is intentionally conservative: it does not guess a replacement caret
for an ambiguous rollback. Fresh selections made after an overlay disappeared
survive its eventual rejection. An endpoint deleted by an edit also clears the
selection; newly invalid local grapheme positions are cleared.

The authority snaps surviving mapped presence to a grapheme boundary according to
association. The client filters remote selections that cannot currently be expressed
in its optimistic text. Full resync, delivery gaps, permission/structural epoch
changes and destruction clear local selections. Old document frames cannot revive
them. Presence caches are cleared on access/structural epoch changes, preventing
later grants from reviving an earlier hidden selection. Closing a connection removes
its presence from subsequent deliveries.

No protected descendant coordinates are sent to an unauthorised recipient. A peer
range spanning protected content is omitted as a whole. The normal client blocks
such ranges before sending, and the authority independently enforces this rule for
forged packets and current permission changes.

## Validation and remaining work

```sh
pnpm exec vitest run --project unit tests/collaboration-selection-presence.test.ts
```

The suite exercises both delivery encodings: insertion/deletion affinity, queued
confirmation without double mapping, backward cross-node ranges, selection copies,
positions in unconfirmed text, delayed packets, late Unicode acceptance, conflicts,
read-only participants, access changes, protected ranges, resync, closure, emoji
and combining-mark boundaries. Existing restricted-write, optimistic-recovery and
protected-content suites remain part of validation.

These are text selections only. Node/cell selections, mounted selection adapters,
composition, remote selection drawing, user labels/colours, heartbeats and timeout
expiry are still outstanding here. The host explicitly schedules presence sends
and projection delivery; no network transport or automatic republishing is hidden
inside the client. The current implementation copies projected text and replays the
queue, and the authority rebuilds coordinate indexes while mapping presence. No
large-document performance claim is made. Durable comment ranges and collaboration
undo remain separate work.
