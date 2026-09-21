# React extensions

The writing demo at `/editor.html` and extension diagnostics at
`/extensions.html` share `src/demo/app/main.tsx`. Both use the same editing core,
owned layout engine, and extension schema. The diagnostics page keeps fixtures
for extension behavior that the writing demo does not expose.

`Editor` attaches the same native mount used by vanilla applications. It borrows
the session and owns attachment cleanup. `useEditorState` selects session state;
`useViewState` observes viewport/layout geometry without owning the view. See
[the mounted view reference](mounted-editor.md) for configuration and readiness.

The demo no longer coordinates graphics, layout, native input or culled DOM.
Tables, images, mentions, underlines, comments and search are browser extension
contributions discovered by the mount. React detail/comment panels use supported
geometry queries and portals; the mention panel retains its parent's context.
An inline atom occupies one U+FFFC code unit, with caret stops before and after
it. Plain-text copy substitutes its label.

The earlier graphics-handle-based `CanvasPrimitive` and manual block-layer
attachment have been removed. A general React node/mark/decoration registration
contract is still milestone 6 work. Existing `createReactRenderers` is a small
application component registry, not a registration with the mounted editor.

Tables and images report their measured height through `ResizeObserver`.
Measurements carry their width so the host can discard stale reports. Height
changes move later blocks without reshaping their text. Table cell text lives in document state with undo/redo and survives unmounting.
Comment replies belong to the external comments extension.

Canvas drawing and DOM placement use the same block coordinates. The host mounts
visible blocks with overscan and pins focused widgets until focus leaves them.
The scene retains shaping while releasing offscreen geometry. See
[retained geometry](editor-retained-geometry.md) and
[viewport reflow](editor-viewport-reflow.md).

Run `pnpm run build`, `pnpm run preview`, then `pnpm run check:editor` to check
mentions, portals, atomic navigation, copy/paste, widget measurements, focus,
and inline layout in Chromium, Firefox, and WebKit. `pnpm run check:transactions`
also checks independent schemas, containers, selections, and durable anchors.
The [public extension boundary](editor-extension-boundary.md) describes those
contracts.

The inline layout path builds object clusters around atoms before packing glyphs
and carets. Atom metric changes reshape their paragraph. Dynamic inline sizing,
a general nested React renderer, accessible canvas reading, and print/export
remain open work.
