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
view.update({ zoom: 1.25, paddingTop: 48 });
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

Transient text-highlight ranges accompany native frames through the public
[decoration contribution](decorations.md), shared with canvas text.

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
The current label contract uses the view's default font family; per-label font
resolution remains milestone 5 work.

The starter `underlineView` uses `defineMarkView`, the schema-bound
[mark rendering contract](rendering-extensions.md). Custom text and mark fields
work without paragraph-specific code. Color, baseline offset and thickness are
configurable extension options. The shared owner retains resident instances and
updates fragments on edits or reflow; canvas-only underlines allocate no DOM.

The starter `mentionView` uses `defineInlineView` to render cached labels,
backgrounds and accessible interaction buttons. Placement, culling and configured
attribute binding belong to the shared renderer owner. Its
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
import { createCommentStore } from '@gprose/extension-comments';
import { commentView, onCommentActivate } from '@gprose/extension-comments/browser';

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

Install `searchView` from `@gprose/extension-search` to paint search matches in
canvas and native text. It subscribes to `editor.find`, including cooperative refresh after
edits and streamed appends. `searchView.configure({ color, activeColor })` changes
the highlight colors. Search state survives view destruction; a remounted view
reads the current query. The demo and public mount use the same search extension.

Native node views receive `frame.textDecorations(textNodeId)`, returning readonly
ranges with a stable `key`, UTF-16 `from`/`to`, a background color and optional
`data-*` attributes. Extensions provide `decorations` with a named source
factory, a `read(id, state)` function and `subscribe(listener)`. Return stable arrays for
unchanged ranges. Keys are scoped to each source and node; the native adapter
qualifies them when combining sources.
Contributions compose in registration order; later backgrounds take precedence.
The table view combines those ranges with document formatting and keeps active
textareas intact. Textarea contents retain native input rendering while editing.

The node-view owner initializes sources only when a renderer reads decorations.
It coalesces external invalidations, prunes composed-range caches to resident text
and releases subscriptions and scheduled work on destruction. Errors reach the
mounted view's error handler. Comments and search exercise the same contract;
native renderers contain no comment/search-specific branches. Sources can target
invalidation to particular node IDs and declare node-local dependencies.
[Decoration widgets](decorations.md#widgets) use the same sources and shared range
owner, including React registrations. Editable content slots remain milestone 6 work. Semantic
marks and inline objects have separate schema-bound rendering registrations.

The layer owns its DOM and styling. The host ignores pointer events by default;
interactive descendants can opt in. Nonsemantic decoration layers set their own
`aria-hidden` attribute. Duplicate names fail before allocation, failed factories
release earlier layers, and destruction attempts every layer's cleanup even when
one throws. Semantic state belongs outside the culled DOM.

The starter `containerDecorations` extension uses this contract for list markers
and quote rules. Numbering, nested containers and continuation paragraphs are
resolved through installed schema definitions. The demo and public mount share
this extension and its stylesheet. General range highlights use `decorations`;
`viewLayers` supports lower-level drawing and DOM placement.

## React

```tsx
import { EditorContent } from '../src/editor-react';

<EditorContent editor={editor} style={{ height: 480 }} onReady={(view) => view.focus()} />;
```

React attaches the same native mount and disposes it on unmount or session
replacement. It does not own the session. Callback changes do not remount the
view. Strict Mode cleanup cancels obsolete initialization. `onError` receives
initialization and background view failures, also displayed in an alert.
`onNotice` receives nonfatal input messages such as a rejected paste. The native
mount also announces these messages through a status element.

`zoom` and `paddingTop` props update the existing view, including while assets are
loading. They preserve its input element, focus and selection. Omitting either
prop restores its default (`1` and `0` respectively). Changing attachment options
such as the session, scroll mode or asset resolver creates a new view. Font and
theme changes update the existing view. See [React integration](react-integration.md)
for owned sessions, context and toolbar selectors.

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
- `getSnapshot()` returns an immutable `ViewSnapshot`, or `null` before the first
  layout and after disposal. It includes the document revision, zoom, viewport
  top/width/height and content left/width/height. Lengths are unscaled document
  units. Snapshot identity stays stable until layout, viewport or editor state
  changes; `version` increases with each replacement. The snapshot describes the
  last published layout, which can lag a new transaction until layout catches up.
- `subscribe(listener)` observes those snapshots, including final disposal.
  Notifications coalesce in a microtask after native reconciliation, so listeners
  can safely update or destroy the view. Read the current snapshot in the listener;
  intermediate synchronous snapshots may be skipped. The returned function
  unsubscribes. Subscription after disposal throws.
- `blockBounds(id, coordinates = 'document')` returns a block's document-space rectangle and rendered owner
  ID. Native descendants, such as cell paragraphs, return their table's bounds;
  use `coordsAt` for their individual text. Flowing containers span their
  projected descendants and measured chrome, including inter-block spacing, with
  their own inherited indentation. Empty flows report their chrome height, or zero
  when they have no chrome. Native blocks and text
  blocks report their allocated width inside that indentation. Pass `'client'` for viewport-relative CSS-pixel bounds suitable for
  application popovers. Uncomposed offscreen blocks can have estimated bounds until reflow.
  Missing nodes, stale document layout and disposed views return `null`.
- `update({ zoom, paddingTop, maxWidth, background })` merges view settings without replacing its
  session, graphics or input. Zoom must be finite and positive; top padding is a
  finite, nonnegative length in document units. Omitted values retain their
  current setting. Updates are validated together before applying, and identical
  settings do no work. Updates during loading apply to the initial layout;
  updates after failure or destruction throw. `maxWidth` is an optional centered
  column width in CSS pixels (`null` uses the available width); editor margins
  remain clickable. `background` is a CSS color, defaulting to white. Changing
  only the background repaints without composing text.
- `reveal(point)` retains the target in layout and returns a promise indicating
  whether it was revealed. It captures a relative position so intervening edits
  map the target before scrolling. A later reveal supersedes an earlier request;
  destruction, an unresolvable position or unavailable geometry resolve `false`.
  Deletion follows the relative-position contract's surviving boundary fallback
  where one exists. The initial point must be a valid text position. Reveal leaves
  selection and focus alone.
  Optional `{ align: 'nearest' | 'start' | 'center' | 'end', margin }` controls
  viewport alignment and clearance in CSS pixels. The default is nearest with no
  margin. Excessive margins are limited to the available height; document edges
  can prevent exact alignment. A fully visible target still resolves `true` when
  scrolling is clamped at an edge.
- `scrollTo(top)` scrolls to an absolute unscaled document offset without changing
  selection or focus. Scroll positions clamp to document edges.
- `scroll: 'page'` uses page scrolling and an optional `toolbar` element as the
  sticky inset. The default uses a scroll container inside the supplied host.
  `editor.commands.scrollIntoView()` reveals the current selection.
- `fonts` supplies view-owned font sources, default family and emoji fallback. See
  [font configuration](view-fonts.md) for matching, readiness and current limits.
- `resolveAsset` maps graphics, shaping and font asset paths to application URLs.
  Native engine handles stay private to the mounted view. Successful immutable
  asset bytes are cached by resolved URL (at most 32 entries / 64 MiB); native
  graphics, fonts and shaping state remain per-view. Failed or cancelled loads
  are not cached. Use versioned URLs when asset contents change.

## Optional diagnostics

Instrumentation is separate from the geometry interface used by editor UI:

```ts
import { createViewDiagnostics } from '../src/editor-canvas/diagnostics';

const diagnostics = createViewDiagnostics();
const unsubscribe = diagnostics.subscribe((event) => {
  if (event.type === 'paint') console.log(event.duration, event.submitted);
});
const view = mountEditor(element, { editor, diagnostics });
await view.ready;
const counters = diagnostics.read();
const placements = diagnostics.placements([paragraphId]);
unsubscribe();
view.destroy();
```

`read()` copies layout counts, generation/pending state, mounted native IDs,
shaping/composition counters, retained cache counts and buffer sizes. Reading memory
counts can traverse retained buffers, so it is intended for audits rather than
per-frame UI. `inspectText({ id, range, hit?, move? })` copies resident line,
range, hit-test and movement results for independent reference audits. It returns
null when no resident layout exists; modifying a probe result cannot mutate the
editor. `placements(ids?)` copies block and inline-box metadata on demand;
omitting IDs inspects the whole document. Neither returns nodes, layout objects,
native resources or mutable buffers. Both return detached values, with `null` and
an empty array respectively while the view is loading or detached.

Layout reports identify their document revision, generation, rendered block count
and width, along with total work/composition times, newly composed IDs and reflow
state. `background` counts blocks composed in the background batch. Paint reports
carry the same frame identity, flush timing, submitted paragraph/native mount
counts and whether visible text geometry was stale. A report's `at` timestamp is
captured when the work finishes; microtask delivery does not affect that timing.
Reports are delivered after native work completes. Unsubscribing or detaching
cancels pending delivery. Counters are gathered on demand and event reports are
created only when subscribed.

One diagnostics handle can follow sequential mounts, including failure/retry, but
cannot attach to two simultaneous views. Its subscriptions remain application
owned across remounts; unsubscribe when the application no longer needs them.
The optional React adapter accepts the same `diagnostics` prop.

For comparative benchmarks, `createViewDiagnostics({ composition: 'eager',
retention: 'all' })` overrides viewport-first composition and bounded retention.
Defaults are `'viewport'` for both. These controls belong to instrumentation and
are not ordinary editor configuration. The view's supported geometry methods
remain available without diagnostics.

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

The writing and extension demos now mount the same public React `EditorContent`. They
create sessions, choose schema/browser extensions and supply application UI;
engine handles and manual layout, input and painting orchestration are gone.
Outline, find and annotation panels use geometry/reveal queries. Streaming
backpressure and the audit harness use separate diagnostics. Independent engine
checks allocate their own temporary resources outside the application view.
