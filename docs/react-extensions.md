# React extensions

The writing demo at `/editor.html` and extension diagnostics at
`/extensions.html` share `src/demo/app/main.tsx`. Both use the same editing core,
owned layout engine, and extension schema. The diagnostics page keeps fixtures
for extension behavior that the writing demo does not expose.

`src/editor-react/index.tsx` provides `CanvasLayerProvider` and `CanvasPrimitive`.
React components register paint callbacks in the current canvas layer. This is
not a custom React reconciler. Document data and inline metrics remain
independent of React and DOM nodes.

`src/extensions/text-block-view.tsx` paints atomic mentions and comment ranges.
DOM targets sit over their canvas geometry; detail and comment panels use React
portals. The mention panel reads its parent's React context. An inline atom
occupies one U+FFFC code unit, with caret stops before and after it. Plain-text
copy substitutes its label.

Tables use a native DOM controller for editing, selection, keyboard input and
measurement; their React component only mounts and updates it. Native table
callers use the same session commands as the React demo.

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
