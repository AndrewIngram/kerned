# Editable content slots

Status: milestone 6 is in progress. Vanilla and React renderers can attach a
content slot to a flowing container. The mounted view measures its chrome and
positions canvas-owned descendants inside it. Existing native tables continue
to own their cell text rendering; this is not a grid-layout replacement.

## Ownership

A custom container renderer owns its chrome, such as a callout heading, border or
button. The existing mounted view owns its descendants' canvas text, selection,
input, scrolling and virtualization. A slot identifies where those descendants
belong inside the chrome. It does not create another editor, graphics owner,
document session, hidden input or editable DOM subtree.

A React node component receives a `content` prop and renders a `NodeViewContent`
child alongside ordinary React controls. Vanilla renderers
attach the same slot to a DOM element. Neither adapter walks the document,
positions individual paragraphs nor shapes text. A slot contains the node's child
sequence; it cannot reorder or duplicate document children. There is one slot per flowing node. Native grid views retain their existing
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

The view assigns the slot's descendant height. The attachment reports the chrome
around that rectangle in unscaled document units. Measurements belong to the
mounted view, not document attributes, and do not cross the shaping boundary.
Nested slots accumulate horizontal padding and reserve headers and footers around
the leaf sequence. Width changes reflow descendants using the existing reading
anchor. At the document start, adding chrome leaves scroll at the start.

Resize and DOM mutation observers detect size and offset changes. Unchanged
chrome measurements do not invalidate layout. Selection and access updates reuse
the compiled flow projection. Empty containers appear in the same ordered flow
walk, including containers with no text descendants.

An empty slot still needs wrapper geometry. It does not imply an editable text
position: the schema or extension must supply a text child before a caret can be
placed within text. The generic view must not insert a starter-kit paragraph.
Culling and destruction release the attachment, observers and scheduled reports.
Numeric chrome estimates remain with the view while their node identity exists,
so culling does not collapse document geometry. Removal prunes those estimates;
reattachment measures current DOM. Stale cleanup cannot detach a successor slot.

## Painting and interaction

Container chrome paints in a DOM plane behind a transparent text canvas. Inline
controls and decorations retain their foreground overlay. The configured page
background belongs to the editor root. There is still one viewport paint owner
and one input owner.

Clicks within a slot continue through the editor's existing closest-line policy.
Chrome buttons retain native behavior. Flow hosts do not carry the atomic-node
pointer marker, so clicking the slot selects text using the closest-line policy.
Focus pins keep chrome mounted without composing all offscreen descendants. Native
nodes, outlines and node-edge widgets share left and right padding allocation.

## Authoring contract

The schema definition must be a container with a `flow` presentation. A bound
node-render frame exposes `content: ContentSlot | null`; box views receive null.
The renderer does not iterate its children.

```tsx
function Callout({ content, attributes }: ReactNodeViewProps<typeof callout>) {
  return (
    <section className="callout">
      <header>{attributes.title}</header>
      <NodeViewContent content={content} />
      <footer>Ordinary interactive controls</footer>
    </section>
  );
}
```

A vanilla renderer creates an empty element inside its mounted root and calls
`content.attach(element)` once. Keep and call the returned cleanup function when
replacing that element or destroying the renderer. The shared owner sets and
restores its inline height. Duplicate attachments and attachment outside the
renderer root throw. Attachments can be released and replaced, including React
Strict Mode's effect replay; destruction is terminal.

Use ordinary vertical DOM flow. Put borders, padding, headers and footers on the
surrounding chrome. Keep the slot empty and undecorated, with no fixed height,
independent scrolling, clipping or transform. A rotated or independently scaled
slot is not supported. Use the mounted editor's zoom setting. The one slot
represents the entire child sequence, not a portal for arbitrary DOM children.

## Verification

Colocated tests cover nested and empty flow geometry, vanilla and React chrome,
header resizing, offset changes without outer resize, inherited padding, zoom,
identity replacement, stale cleanup, context, scoped selection, live permissions,
Strict Mode, focus retention and culling/remounting. The integration test in
`tests/content-slots.browser.test.ts` exercises the starter schema's real pointer
selection, typing, rich copy and undo across a quote boundary. Rendered screenshots
are in `artifacts/public-interface-m6/content-slots/`.

A 4,096-paragraph nested-slot stress case moves a subtree and edits text while
background layout is pending, then changes width. It checks the viewport reading
anchor, parent/child/DOM geometry after background reflow, bounded resident text
and mounted chrome, and removal of the moved subtree. It runs in Chromium,
Firefox and WebKit.

Milestone 6 implementation is ready for its independent architecture judge after
the required validation and commit. Any agreed findings must be resolved before
starting milestone 7.
