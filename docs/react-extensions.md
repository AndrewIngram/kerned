# React extensions for a canvas editor

Status: a hybrid integration spike is implemented at `/hybrid-editor.html`. It includes a measured React checklist, a canvas-painted atomic mention with a React details panel, and a canvas range highlight with a React comment panel. See [the implementation and validation report](react-extensions-spike.md). The registry interface below remains a proposal.

## Recommendation

Keep document data, shaping, layout, caret positions and range geometry in the owned pipeline. Offer React as an optional authoring and interaction layer:

- Canvas primitives for text, images, rules, backgrounds, badges and decoration paint.
- Ordinary React DOM components for interactive content placed in rectangles calculated by the editor.

React DOM creates DOM nodes. Existing components returning `div`, `button` or a chart library's DOM cannot become canvas drawing commands automatically. They can remain real DOM in an overlay. React portals preserve the surrounding React context while rendering into another DOM container; events still bubble through the React tree. Source: [React createPortal](https://react.dev/reference/react-dom/createPortal).

A separate React-to-canvas adapter can translate a restricted primitive vocabulary into editor-owned objects and draw commands. React's custom reconciler package is explicitly experimental. A full custom renderer should therefore be an optional, isolated adapter, not a dependency of text layout. Components relying on DOM elements, CSS layout or DOM refs need the DOM adapter. Source: [React reconciler documentation](https://github.com/react/react/blob/main/packages/react-reconciler/README.md).

## The three extension kinds

| Kind | Layout responsibility | Suggested first support |
|---|---|---|
| Custom block | Editor supplies available width; extension supplies fixed, estimated or measured height | Interactive React card occupying a block rectangle |
| Inline element | Extension supplies width, ascent and descent; editor wraps and positions the box with text | Atomic mention/chip with caret positions before and after |
| Decoration | Editor resolves anchored ranges into rectangles; most decorations do not change layout | Canvas highlights/underlines, with a DOM comment button or tooltip |

An inline React widget is initially one atomic box. Its inner controls may use normal browser focus, but its internal DOM text is not part of the editor's text selection. A component that contributes editable, line-wrapping text must emit owned text runs/spans. Arbitrary browser inline layout cannot be mixed into our line breaker with identical wrapping and caret semantics for free.

Text decorations that change font, weight, spacing or inline dimensions require layout invalidation. Paint-only highlights do not. DOM annotations attached to a multi-line range need several rectangles or a declared anchor rectangle, not a single guessed bounding box.

## Data and ownership

Store stable IDs, extension type and serializable payload in the document. Keep React elements, component instances, DOM nodes and callbacks in a main-thread extension registry. Undo, export and optional worker messages contain document data, not JSX or React state.

A proposed interface shape, not a shipped API:

```ts
// Document model
{ kind: 'custom-block', id, extension: 'chart', data: chartData }
{ kind: 'inline-atom', id, extension: 'mention', data: { userId } }

// Host registry
registerExtension('chart', {
  measure: ({ availableWidth, data }) => ({ width: availableWidth, height: 240 }),
  renderDOM: ChartComponent,
  export: exportChart,
});

registerExtension('mention', {
  measureInline: ({ data, textStyle }) => ({ width, ascent, descent }),
  paint: paintMention,
  renderDOM: MentionPopover,
});
```

The document owns persistent data, selection and undo. Components dispatch document commands rather than mutating layout buffers. Transient UI state belongs to React; state that must survive virtualization must be stored outside an unmounted component, keyed by stable ID.

The current `OwnedBlock` is text-only, with positional splice operations and local spans. The main editor model already gives blocks stable IDs and has image/embed atoms, but the new owned block session does not yet consume those atom types. Supporting extensions requires a discriminated block model and an inline item model. We should share those concepts rather than invent an unrelated React document tree.

## Measurement and invalidation

Prefer dimensions known without mounting DOM: fixed sizes, aspect ratios or a deterministic measurement function. The engine can then reserve space for content before it arrives or mounts.

For content whose height depends on DOM layout:

1. Reserve an estimated rectangle at a known width.
2. Mount the component in the visible/overscan range.
3. Observe its border-box size and report a measurement tagged with block ID, content revision and measurement width.
4. Ignore stale reports. Commit changed dimensions in a batch, invalidate the affected placement, and preserve the scroll anchor.

[ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver) reports element size changes. It does not solve baseline metrics for arbitrary inline components; their ascent/descent must come from the extension contract or a deliberate baseline-measurement adapter. Avoid measuring DOM synchronously on every caret move or scroll event. Prevent feedback loops where the observed size continuously changes the width that produced it.

Inline size changes can reflow their paragraph. Block height changes move following blocks without reshaping their text. Offscreen content whose size is unknown needs estimates; exact scroll height before measuring every such component cannot be promised.

## Viewport and rendering

Use one document-coordinate visibility index for canvas submissions and DOM mount decisions. Positions use CSS pixels; backing-store DPR applies only to canvas rasterization. Scroll, zoom and clipping must use the same coordinate transform in both layers.

Keep one React application tree with a stable overlay container and keyed children/portals, rather than creating a root per widget. Place widgets absolutely using editor geometry. Mount visible content with a small overscan range, and retain focused/composing widgets even if they leave that range. Position updates must not rebuild all document components on every scroll tick.

The overlay layer ignores pointer events by default. Interactive children opt in. The editor handles canvas hit testing and selection; widgets take focus explicitly. Native selection inside a widget must not accidentally replace editor selection. Focus return, arrow traversal, deletion, clipboard behavior and undo are part of the extension contract, not incidental DOM event handlers.

The new owned viewport drawing method binary-searches the first potentially visible paragraph and submits only intersecting paragraphs, accounting for conservative font bounds and shaping offsets. It currently works at paragraph granularity. One very long paragraph still submits all of its glyph runs. Effects that paint outside their layout rectangle will need explicit visual overflow bounds so culling does not remove visible paint.

## Worker and dependency boundary

React DOM remains on the main thread. If layout later uses a worker or `use worker`, exchange serializable updates and measured numeric dimensions. Keep the registry, focus and DOM lifecycle on the main thread. Worker transport is optional; this design does not introduce a serialization step into the current layout loop.

Pure layout, viewport queries and numeric geometry stay independent of React. A React update should change the affected extension or document block, not trigger paragraph layout merely because a parent component rerendered.

## Export and accessibility

Canvas pixels and overlaid DOM are separate outputs. Each custom element needs a defined clipboard/export representation and a print/screenshot strategy. A canvas export alone will omit DOM widgets. Interactive controls can retain their native DOM semantics, but that does not provide an accessible reading/selection model for the surrounding canvas document; that remains a separate editor requirement.

## First integration spike

Use one interactive block, one atomic inline mention, and a range highlight with a DOM comment control. Verify:

- Geometry alignment at fractional DPR, scrolling, resizing and zoom.
- Mount counts proportional to the viewport, including focused-widget pinning.
- Measurement changes and stale reports across edit, undo and unmount.
- Caret traversal, selection, deletion and copy/paste around inline atoms.
- Component state and React context across virtualization.
- Canvas-only fallback/export for the selected examples.

Start with ordinary DOM overlays plus direct canvas paint callbacks. This proves the geometry and interaction contract before deciding whether a full React custom renderer earns its maintenance cost.
