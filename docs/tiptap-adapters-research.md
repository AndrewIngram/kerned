# Tiptap adapter and persistence patterns

Audited 2026-09-21 against the official documentation. This is a design input,
not a claim that these interfaces already exist in gprose. Recommendations below
are our interpretation; cited observations describe Tiptap.

## React integration and subscriptions

**Observed:** Tiptap's React entry point offers `useEditor` and `EditorContent`;
its provider integration offers `useCurrentEditor`. The latter needs provider
context rather than merely a nearby `useEditor` call. This separates instance
creation, mounting and access from descendants.
[React integration](https://tiptap.dev/docs/editor/getting-started/install/react).

**Observed:** `useEditorState({ editor, selector })` subscribes to derived values
and compares the result before rerendering. The performance guide recommends
isolating the editor from unrelated parent state and documents
`shouldRerenderOnTransaction: false`. It also warns that synchronously mounted
React node views can be costly when numerous.
[Performance guide](https://tiptap.dev/docs/guides/performance).

**Adopt:** An optional React adapter with instance ownership, a mounting
component, context access, and selector subscriptions. Toolbar state should
subscribe only to selected formatting/capabilities. State publication must not
rerender every block or recreate layout resources.

**Adapt:** React renders extension UI, not every glyph. Keep viewport culling,
layout, input, and renderer lifetime in the framework-independent view module.
Make ownership explicit when a hook receives an existing editor versus creates
one; remounting must not accidentally destroy an externally owned session.

## SSR and static output are different contracts

**Observed:** The Next.js guide sets `immediatelyRender: false` to defer editor
initialization until client hydration.
[Next.js integration](https://tiptap.dev/docs/editor/getting-started/install/nextjs).

**Observed:** Static Renderer accepts JSON plus extensions without a DOM or
editor instance and produces HTML, Markdown or React output. It offers separate
imports and custom node/mark mappings. Interactive node views are not reused
automatically; their static mappings must be supplied.
[Static Renderer](https://tiptap.dev/docs/editor/api/utilities/static-renderer).

**Adopt:** A separate static rendering module and extension-owned serializers.
Headless session imports and server output must not initialize graphics, access
`window`, or import React transitively. Static rendering needs explicit handling
for unsupported content.

**Adapt:** Server-rendered semantic HTML can be a useful read-only output; it is
not a promise of identical canvas pagination. Canvas mounting is client-only,
with a documented readiness state for asynchronous fonts/rendering resources.

## Custom node and mark views

**Observed:** `addNodeView()` can return `ReactNodeViewRenderer(Component)`.
React node views use `NodeViewWrapper` and `NodeViewContent`; wrapper and content
elements are distinct. Node selection state is exposed, with an option to also
mark a node selected when a text selection lies entirely inside it.
[React node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react).

**Observed:** `addMarkView()` accepts `ReactMarkViewRenderer(Component)`; the
component can use `MarkViewContent` and an `updateAttributes` callback. The prose
recipe currently incorrectly names the node renderer, whereas its code uses the
mark renderer; the code example is the relevant pattern here.
[React mark views](https://tiptap.dev/docs/editor/extensions/custom-extensions/mark-views/react).

**Adopt:** Extensions register views through a documented adapter and receive
semantic state plus commands for updates. View instances must not mutate stored
nodes directly. Selection, editability, drag handling and teardown belong to
the shared view contract.

**Adapt:** Our editable-content slot represents canvas-owned descendants rather
than a `contenteditable` DOM subtree. Support canvas primitives and interactive
DOM overlays through one geometry/selection contract. A mark spanning wrapped
lines may have multiple fragments; do not pretend it always owns one DOM box.
Interactive controls opt out of caret placement explicitly.

## Decorations and external annotations

**Observed:** Current docs expose `addDecorations()` and node, inline and widget
decorations. These change editor appearance without changing serialized content.
Widget keys must be stable and position-independent. Update strategies include
whole-document rebuilds, changed-range updates for block-local dependencies, and
manual invalidation for external state. Framework widget renderers support React
or Vue. Decoration builders receive the correct transaction state explicitly.
[Decorations](https://tiptap.dev/docs/editor/core-concepts/decorations).

**Adopt:** A public extension decoration contribution with explicit invalidation,
stable widget identity and the state snapshot being processed. Comments and
search should use this interface without core knowledge of either feature.

**Adapt:** Decoration values should describe semantic visual treatments and
anchors, with canvas and DOM view adapters. DOM attributes alone cannot express
our view. Preserve durable external range values independently of transient
decoration instances. Changed-range updates are valid only when dependencies
are local; culling concerns visibility, not range identity or document indexing.

## Content codecs and persistence

**Observed:** The output guide documents JSON and HTML export plus `onUpdate`
for applications saving content.
[JSON and HTML output](https://tiptap.dev/docs/guides/output-json-html).

**Observed:** The Markdown module extends the existing editor instead of
introducing another editor class. It provides `getMarkdown`, parse/serialize
access, and a `contentType` option for insertion/replacement. Extension contracts
can contribute Markdown parsing and rendering. The documentation labels this
module beta.
[Markdown editor interface](https://tiptap.dev/docs/editor/markdown/api/editor).

**Adopt:** One session regardless of source format; optional codecs translate at
system boundaries. Extensions own semantic encoding. JSON snapshots, HTML,
Markdown and clipboard fragments require explicit supported-content and
round-trip contracts.

**Adapt:** Prefer explicit format values and validated failures over ambiguous
string guessing. Lossy exports should be documented. Do not serialize the whole
document on every transaction as a mandatory integration pattern; offer change
events and explicit snapshots so persistence can batch work.

## Positions, navigation and collaboration

**Observed:** `NodePos` wraps resolved positions and provides parent/child/sibling
navigation, type-and-attribute queries, offsets and convenience mutations. Its
interface also exposes a DOM element.
[Node positions](https://tiptap.dev/docs/editor/api/node-positions).

**Adopt:** Ergonomic structural queries. **Adapt:** Keep document queries usable
headlessly; geometry/DOM lookup belongs to the view. Distinguish snapshot
locations from durable references in types, and execute mutations as commands.

**Observed:** Position utilities create/map serializable positions, substituting
collaboration-aware positions when enabled. The docs explicitly note a Yjs
paragraph-split limitation: an anchor in the moved second half can resolve to
the first paragraph's end instead of following the text.
[Position utilities](https://tiptap.dev/docs/editor/api/utilities/position).

**Adopt:** Simple capture, serialize and resolve operations. **Adapt:** Keep our
stronger intended split/join/move/delete/undo guarantees; copying method names
does not establish durability. Specify association and unresolved/deleted
results, and test persisted references across checkpoint/reload and concurrent
edits. Do not require documents to register each external range.

**Observed:** Collaboration configuration accepts a Yjs document/field or raw
fragment. It supplies its own history and instructs consumers to disable the
ordinary UndoRedo extension. The docs also identify initialization-order issues
when UniqueID runs before initial synchronization.
[Collaboration extension](https://tiptap.dev/docs/editor/extensions/functionality/collaboration).

**Observed:** Hocuspocus persistence stores encoded Yjs binary. JSON can be an
additional export, but recreating collaboration state from JSON loses the merge
history and can duplicate content.
[Hocuspocus persistence](https://tiptap.dev/docs/hocuspocus/guides/persistence).

**Adopt:** Collaboration is an optional integration with explicit readiness and
history ownership. **Adapt:** These docs do not decide OT versus CRDT for us.
Separate ordinary content snapshots, durable-reference checkpoints, and future
collaboration persistence. Capability conflicts should fail during composition
instead of silently installing two undo owners. Node permissions/locking still
need enforcement in our transactions and authority, not only disabled views.

## Acceptance scenarios for the public-interface refactor

1. A React toolbar updates its own selected state without rerendering unrelated
   blocks or recreating the view.
2. A vanilla browser consumer and React consumer use the same commands, input
   behavior, typography settings and renderer lifetime.
3. A custom node provides headless semantics, canvas/overlay editing appearance,
   and static output without requiring any one representation to impersonate
   another.
4. A comments extension uses persisted ranges and decoration contributions;
   core and model never import comments.
5. Server code imports schemas, commands and codecs without browser globals,
   font downloads, CanvasKit initialization, or React dependencies.
6. Format import/export tests cover unsupported nodes and marks explicitly;
   checkpoint reload preserves durable anchors without confusing export JSON
   with collaboration state.
