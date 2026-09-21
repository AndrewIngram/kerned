# Editable content slots

Status: milestone 6 is in progress. The view can query nonempty flowing-container
bounds and places native descendants within their inherited indentation. The
content-slot registration and React component described below are still to be
implemented. Existing native tables continue to own their cell text rendering.

## Ownership

A custom container renderer owns its chrome, such as a callout heading, border or
button. The existing mounted view owns its descendants' canvas text, selection,
input, scrolling and virtualization. A slot identifies where those descendants
belong inside the chrome. It does not create another editor, graphics owner,
document session, hidden input or editable DOM subtree.

The intended React author experience is a node component with a content-slot prop
and a `NodeViewContent` child alongside ordinary React controls. Vanilla renderers
attach the same slot to a DOM element. Neither adapter walks the document,
positions individual paragraphs nor shapes text. A slot contains the node's child
sequence; it cannot reorder or duplicate document children. The first contract
will have one slot per flowing node. Native grid views retain their existing
explicit ownership contract rather than pretending that a grid is one vertical
flow.

## Layout responsibilities

The document projection now records the half-open rendered-block span of each
flowing container. These are view indices, not editable or durable document
positions. Selection-only snapshots reuse the projection. Native descendants
resolve to their native rendered owner, and empty flows retain an empty span.
Container geometry can use the first and last placement without traversing or
composing descendants during each query. It includes internal paragraph spacing
and retains estimated offscreen heights while composition proceeds.

The remaining layout work must reserve the chrome around a slot. The view will
assign the slot's descendant height; the slot attachment will report its offset,
available width and the surrounding chrome dimensions. Those measurements must
be local to the mounted view and tied to the current node/width/configuration.
They must not become document attributes or pass through the shaping boundary.
Unchanged chrome measurements must not recompose paragraphs when only selection
or access changes. Nested slots must compose their offsets. Width changes reflow
descendants and preserve the existing reading anchor.

An empty slot still needs wrapper geometry. It does not imply an editable text
position: the schema or extension must supply a text child before a caret can be
placed within text. The generic view must not insert a starter-kit paragraph.
Missing, culled and destroyed slot attachments must release their observers and
measurements, and stale asynchronous reports must not resize a successor view.

## Painting and interaction

Container chrome backgrounds must paint behind canvas descendants. The current
single overlay above an opaque text canvas cannot support an ordinary opaque
React wrapper background. The implementation must establish a DOM chrome plane
behind a transparent text plane, while preserving the foreground overlay used by
inline controls and decorations. It must retain one viewport paint owner and
existing resource disposal. Splitting this ownership into nested editor views
would duplicate input, selection and layout lifetimes, so that approach is ruled
out.

Clicks within a slot continue through the editor's existing closest-line policy.
Chrome buttons retain native behavior. Container backgrounds must not cause the
whole subtree to be selected when the user intended to place a text caret.
Container focus pins must keep the relevant chrome mounted without composing
all offscreen descendants. Nested native nodes and decoration widgets must share
the same allocated bounds after indentation, zoom and reflow.

## Completion evidence still required

- A real vanilla container and a React container, each with canvas-owned text
  descendants and interactive chrome, using the same slot owner.
- React context, scoped selection and live access changes inside the wrapper.
- Typing, cross-node selection, clipboard and undo across slot boundaries.
- Header/footer resizing, nested containers, width/zoom changes, empty content,
  node movement/removal and stale measurement rejection.
- Correct background/text/foreground paint order, verified from the rendered
  artifact, and unchanged native table behavior.
- Offscreen culling and remounting, focused controls, Strict Mode and cleanup.
- Large-document loading, reflow, retained memory and existing performance gates.

These are completion requirements for the content-slot work, not deferred product
features. Milestone 6 remains open until they are implemented and verified, then
committed and independently judged.
