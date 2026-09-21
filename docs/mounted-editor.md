# Mounted editor interface

The native mount and React component share one view lifetime. The session owns
canonical content, transactions and history. A mounted view borrows that session
and owns its DOM, input capture, viewport, layout, graphics and native node views.

```ts
import { mountEditor } from '../src/editor-canvas';

const view = mountEditor(element, { editor });
await view.ready;
editor.commands.focus();

const caret = view.coordsAt({ id: paragraphId, offset: 3 });
await view.reveal({ id: paragraphId, offset: 3 }); // Keeps focus and selection unchanged.
view.destroy(); // The editor session remains usable and can be mounted again.
```

The compiled schema must install presentation contributions for rendered nodes
and flowing containers. Native boxes additionally need node-view contributions.
The mount discovers both from the composed session; callers do not provide an
engine, schema copy, presentation callback or parallel renderer list.

`defineNodePresentation(definition, factory)` binds to the installed definition
family, including configured variants. The factory runs once per view and returns
a function receiving normalized attributes plus node identity, child count,
semantic mark ranges and inline values. It returns text/box metrics or a flowing-container policy.
Immutable node presentations are cached per view. Duplicate or missing
presentations produce explicit errors.

Input extensions contribute through `inputPolicies` from `src/editor-browser`.
They receive the imperative session, native text capture, navigation/select-all
helpers and a notice callback. Navigation,
select-all, composition lifetime and focus synchronization belong to the mount;
extensions implement schema-specific edits and clipboard policy. There can be
one text-input owner, with multiple keyboard/clipboard handlers in assembly
order. A prevented keyboard/clipboard event stops further handlers. Without a
text-input owner, the capture is read-only while navigation remains available.

Native node-view factories receive the imperative session, the view's clipboard
dispatcher and a notice callback. Their update frame carries the current
selection and the mount's cached selection context. A view can implement
`focusSelection` for native text controls; the mount resolves the selected
descendant to its rendered owner before falling back to canvas input. The table
extension uses this contract for cell editing and rectangular selection, with
the same clipboard policy as the canvas capture. Its styles belong to the
browser extension and do not require the demo stylesheet.

Native views can implement `coordsAt(point)` to supply client caret coordinates
for their text descendants. They can also implement `reveal(point)` to scroll
their own containers without changing focus or scrolling the document. The mount
then handles outer scrolling. Tables implement both, including inactive styled
cell text and active textareas.

Transient text-highlight ranges can accompany native frames. This is an internal
rendering contract, not the final extension decoration-authoring interface.

Document overlays contribute through `viewLayers` from `src/editor-browser`.
Each named contribution creates one layer per mounted view and returns `update`
and `destroy` methods. Its factory receives the imperative session, a positioned
DOM host, text preparation and a `paint` registration function. Factories run
after view assets are ready. Update frames contain resident blocks, including overscan and pinned
interaction targets, with unscaled document bounds and flowing ancestors. Each
ancestor includes its canonical node, child index and inherited inset. The mount
uses its existing document index and caches these paths; extensions do not receive
graphics handles or private layout objects.

Layers can subscribe to external state and call `invalidate()`. Repeated requests
coalesce into one update of that layer using the latest published frame. They do
not create document transactions or rerun unrelated layers. Pending updates are
cancelled at destruction; late invalidations are harmless. The mount reports
asynchronous update failures through its normal error contract.

`listen(eventName, listener)` observes native events within the editor overlay,
with automatic cleanup. `nodeAt(event.target)` resolves a resident native owner.
`onTextPointer(listener)` observes normalized text starts/drags from the shared
input controller after selection has been applied. This handles pointer capture,
which can redirect a final DOM click away from the original text or image.

For canvas text, `block.text.fragments(from, to)` returns rectangles and baselines
for a UTF-16 range. Coordinates are block-local and include the inherited text
inset; add `block.left` and `block.top` to obtain document coordinates. Native
boxes have no canvas text geometry and return `null` for `block.text`.
`block.inline` contains inline identities, UTF-16 offsets and block-local bounds.
Extensions read semantic attributes from the canonical node through the schema.

`paint('background' | 'content', callback)` registers one painter per layer plane.
A subsequent call replaces it; passing `null` removes it. The callback receives a
borrowed `Drawing` supporting `rect(bounds, cssColor, radius?)` in unscaled document
coordinates. The mount owns scrolling, zoom and graphics state. Drawing outside
the callback throws. Registrations are released with the view layer, including
when its factory or destructor throws.

`prepareText({ text, width, size })` prepares a label during an update or factory
call. It returns an immutable, view-owned token with width and height.
`drawing.text(label, left, top)` paints it without shaping in the paint callback.
The view keeps a bounded label cache across viewport culling. Tokens cannot be
drawn by another view, and text preparation rejects calls after layer destruction.
The current label contract uses the existing default font; configurable font
resolution remains milestone 5 work.

The starter `underlineView` uses this geometry and drawing contract. It reads mark
ranges through the installed schema, so custom text and mark fields work without
paragraph-specific code. Color, baseline offset and thickness are configurable
extension options. Only resident geometry is retained, and edits or reflow
invalidate cached fragments.

The starter `mentionView` reads inline values through schema capabilities and
renders cached labels, backgrounds and accessible interaction buttons. Its
stylesheet belongs to the extension. Both the demo and public mount use it.
Applications observe activation without supplying callbacks as serialized options:

```ts
import { onMentionActivate } from '../src/extensions/starter-kit/browser';

const unsubscribe = onMentionActivate(editor, ({ nodeId, id, index }) => {
  // Open application UI for this mention. The extension does not choose a panel.
});
```

Listeners belong to one session and are cleared when it is destroyed. Unmounting
a view removes its buttons and painters while session listeners remain available
for a later mount. Mention IDs are scoped to their text node.

Comments are an optional extension with an externally owned source:

```ts
import { createCommentStore } from '../src/extensions/comment';
import { commentView, onCommentActivate } from '../src/extensions/comment-view';

const comments = createCommentStore<{ body: string }>();
const extension = commentView(comments).configure({ color: '#f6eab4' });
// Include extension before the browser starter tuple in createSchema({ extensions }).
const unsubscribe = onCommentActivate(editor, ({ nodeId, id, index, focus }) => {
  // Open application discussion UI. focus === 'text' preserves the current caret.
});
```

Source injection is separate from serializable visual options. Its `state.threads`
and `subscribe` contract also accepts an application-owned discussion store.
Sources publish immutable snapshots: replace `state.threads` when threads change
before notifying subscribers. The projection reuses unchanged snapshots.
The extension projects durable ranges, draws wrapped text highlights and outlines
commented native blocks. It keeps typing/caret behavior on non-atomic highlights,
and ignores buttons and inputs inside native blocks. Messages stay outside schema
content and text history. Unmounting releases source subscriptions; remounting
reads the current source. Native text descendants, such as individual table-cell
text ranges, receive highlights through the native text-decoration contract.
Native editing controls retain their own click/focus behavior.

Install `searchView` from `src/extensions/search-view` to paint search matches in
canvas and native text. It subscribes to `editor.find`, including cooperative refresh after
edits and streamed appends. `searchView.configure({ color, activeColor })` changes
the highlight colors. Search state survives view destruction; a remounted view
reads the current query. The demo and public mount use the same search extension.

Native node views receive `frame.textDecorations(textNodeId)`, returning readonly
ranges with a stable `key`, UTF-16 `from`/`to`, a background color and optional
`data-*` attributes. Extensions provide `nativeTextDecorations` with a source
factory, a `read(id)` function and `subscribe(listener)`. Return stable arrays for
unchanged ranges. Keys should include the extension's name to avoid collisions.
Contributions compose in registration order; later backgrounds take precedence.
The table view combines those ranges with document formatting and keeps active
textareas intact. Textarea contents retain native input rendering while editing.

The node-view owner initializes sources only when a renderer reads decorations.
It coalesces external invalidations, prunes composed-range caches to resident text
and releases subscriptions and scheduled work on destruction. Errors reach the
mounted view's error handler. Comments and search exercise the same contract;
native renderers contain no comment/search-specific branches. Arbitrary mark and
widget rendering, localized change-range invalidation and React registrations
remain milestone 6 work.

The layer owns its DOM and styling. The host ignores pointer events by default;
interactive descendants can opt in. Nonsemantic decoration layers set their own
`aria-hidden` attribute. Duplicate names fail before allocation, failed factories
release earlier layers, and destruction attempts every layer's cleanup even when
one throws. Semantic state belongs outside the culled DOM.

The starter `containerDecorations` extension uses this contract for list markers
and quote rules. Numbering, nested containers and continuation paragraphs are
resolved through installed schema definitions. The demo and public mount share
this extension and its stylesheet. External invalidation is supported; the planned
general range-decoration and localized change-range interface remains milestone 6 work.

## React

```tsx
import { Editor } from '../src/editor-react';

<Editor editor={editor} style={{ height: 480 }} onReady={(view) => view.focus()} />;
```

React attaches the same native mount and disposes it on unmount or session
replacement. It does not own the session. Callback changes do not remount the
view. Strict Mode cleanup cancels obsolete initialization. `onError` receives
initialization and background view failures, also displayed in an alert.
`onNotice` receives nonfatal input messages such as a rejected paste. The native
mount also announces these messages through a status element.

## Lifetime and coordinates

- `ready` resolves after assets, layout, input and painting have been attached.
  It rejects on initialization failure or destruction during loading.
- `status` is `loading`, `ready`, `failed` or `destroyed`. `error` retains the
  failure. An optional `onError` callback reports initialization and background
  layout/paint errors. Failures release the attachment and allow a fresh mount
  on the same session.
- Session destruction destroys its mounted view, including pending asset loads.
  Destroying an old view again cannot affect a replacement.
- `coordsAt` returns client coordinates for resident canvas or native text. It
  returns `null` before readiness, after destruction, for invalid positions, when
  layout is stale, or when the rendered owner has no text geometry. Reading
  coordinates does not change scroll, native selection or focus.
- `reveal(point)` retains the target in layout and returns a promise indicating
  whether it was revealed. It captures a relative position so intervening edits
  map the target before scrolling. A later reveal supersedes an earlier request;
  destruction, an unresolvable position or unavailable geometry resolve `false`.
  Deletion follows the relative-position contract's surviving boundary fallback
  where one exists. The initial point must be a valid text position. Reveal leaves
  selection and focus alone.
- `scroll: 'page'` uses page scrolling and an optional `toolbar` element as the
  sticky inset. The default uses a scroll container inside the supplied host.
  `editor.commands.scrollIntoView()` reveals the current selection.
- `resolveAsset` maps graphics, shaping and font asset paths to application URLs.
  Native engine handles stay private to the mounted view.

## Migration status

This interface is exercised with custom-schema vanilla and React editors. The
browser starter tuple now contributes text editing and paragraph/heading
presentations. Its input policy supports custom text fields through schema
capabilities and shares command definitions with the named command API.
Mounted browser tests cover typing, stored marks, history, paragraph splits,
native table-cell editing and rich rectangular clipboard operations. Table
cells can contain custom text-node definitions. Ordinary copy/cut and text
paste within a native cell textarea still use its native behavior; this does
not provide rich clipboard parity for every cell text selection yet.
Search and comment rendering are shared across canvas and native text. Mention
rendering is shared between mounts; a general custom-inline presentation contract
remains future work.

The writing demo still uses its existing starter composition and an internal
`EditorEventHost`; it has not switched to this mount yet. It now uses the same
table node-view, container-decoration, underline, mention, comment and search contributions as the mount.
Supported view updates and diagnostic contracts must be completed before that
switch. The old event host is not a second public editor interface. Milestone 4
remains open until the demo uses the shared mount and stops passing graphics
handles through its tree.
