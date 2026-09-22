# Mounted collaboration demo

Run `pnpm dev`, then open `/collaboration.html`. The full editor and book samples
remain at `/editor.html`. The collaboration page has its own document and does
not load the book samples.

Alice and Bob each mount an independent editor. Type in either pane, select text,
or pause delivery and type in both before resuming. Remote selections use canvas
text decorations and DOM caret labels through the public view contribution API.
The panes stack on narrow screens. Presence sends on selection changes, including
keyboard and pointer movement with no document edits. Presence packets do not
create document transactions, revisions or undo entries.

## Ownership

- `packages/collaboration-lab` owns the experimental authority, filtered byte
  protocol, optimistic recipient and editor binding. It is a private workspace
  package, not a stable production collaboration backend.
- `createTextReplica` supplies an extension that rejects unsupported transactions,
  decodes a received projection into a local document, maps text and selection
  changes, and exposes requests and presence packets to a transport owner.
- The browser entry supplies remote presence and protected placeholder views.
  The core editor has no collaboration-specific rendering or React dependency.
- `apps/demo/src/collaboration/room.ts` owns the local authority, the two principals,
  the sample document and a microtask delivery loop. React observes room status and
  mounts `EditorContent`; it does not rebase edits or interpret wire messages.
- Automerge delivery remains an optional comparison adapter. JSON recipients do
  not import its runtime or WASM. The earlier headless tests now exercise the
  same package implementation used by the mounted demo.

## Protected content

The authority projects the document before serialization. Bob's received bytes
and editor document contain only the private block's opaque key and locked state,
not its payload. Bob's local placeholder has no private text. A selection that
crosses a protected block is not published as presence.

Both principals and the trusted authority run in one browser realm for this
experiment. Someone inspecting the entire page can access Alice's content. This
is a transport-filtering and mounted-interaction demonstration, not an authenticated
server deployment or a security sandbox between panes.

## Current limits

The mounted binding supports text edits inside existing blocks and text presence.
It rejects formatting, structural transactions and undo before publication. It
uses the ordinary editor input and navigation system, so unsupported commands do
not corrupt the document. Enter cannot create a new block in this experiment.

Pause suspends requests and presence delivery, while local edits remain immediate.
Resume submits both outstanding heads before delivering their projected frames.
It publishes presence again after confirmation, so carets inside newly accepted
text become visible without waiting for another keystroke.
Disjoint edits converge; overlapping replacements can discard an unconfirmed
edit, with a visible conflict notice. This deliberately conservative conflict
policy is unchanged from the headless proof. Each keystroke is an operation, so
concurrent typing at the exact same offset can interleave characters. Preserving
whole typing runs at that position needs further protocol work.

The binding expects fixed structure and permissions for its lifetime. A changed
manifest, delivery gap or malformed packet closes the mounted editor and binding
and requires a fresh projection and editor;
it must never keep showing an old readable projection after permission revocation.
The headless authority supports policy changes, but the demo has no policy editor.
There is no persistence, authenticated network transport, reconnect UI, expiry of
presence, or collaborative undo. IME under concurrent delivery still needs a
separate proof.

## Validation

Unit tests exercise independent session ownership, delayed concurrent typing,
conflicts, unsupported edits, cleanup, and private-content absence. Browser tests
mount both real editors in Chromium, Firefox and WebKit, type through native input,
check remote caret geometry and selection decorations, and exercise rejected
shortcuts and protected editing. Existing filtered-delivery and Automerge tests
continue to verify the byte protocol.
