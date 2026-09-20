# Hybrid React extension spike

Implemented in `src/hybrid-spike.tsx`, with document edits in `src/extensions/demo-model.ts` and inline shaping assembly in `src/owned-inline.ts`.

Run `npm run spike:hybrid` and open `/hybrid-editor.html`. For production validation:

```sh
npm run build:hybrid
npx vite preview --config vite.hybrid.config.ts --host 127.0.0.1 --port 5176
npm run check:hybrid
```

## What the spike establishes

React can author canvas paint callbacks and mount ordinary DOM components over the same owned layout. The demo has a canvas mention with a DOM hit target and details panel, a canvas range highlight with a React comment panel, and an expandable React checklist in document flow. The nearby panels use React portals; the mention panel reads its parent's React context.

The engine receives numeric inline metrics and serializable document data. It does not receive JSX or DOM nodes. React is a dependency of this separate demo, not the layout engine. CanvasKit still draws glyphs and HarfRust still shapes text through the existing bridge. There is no new worker, JSON adapter or serialization boundary.

An inline atom occupies one U+FFFC code unit. Its glyphless cluster has a width and caret stops before and after it. The owned composer wraps and positions it alongside text. Selection and deletion treat the mention as one item; plain-text copy substitutes its label. Paste normalizes newlines to spaces and strips unregistered object placeholders.

A checklist reports its actual height through ResizeObserver. Reports carry the measurement width, and stale-width reports are ignored. Changed heights move later blocks without reshaping their paragraphs. Checkboxes, notes and comment replies live in document state with undo/redo, so they survive component unmounting. Measurement caches survive scrolling. Unknown offscreen heights use estimates.

Canvas submissions and DOM mounts use the same document placements. A binary search finds visible blocks with overscan. Focused widgets remain mounted outside that range, in document order. The editor owns scroll anchoring; native browser anchoring is disabled to prevent the two systems from competing. The canvas surface is reused across selection, scroll and widget updates and recreated when its width changes.

## Validation

`npm run check:hybrid` runs Chromium, Firefox and WebKit at viewport widths 1100, 420 and 760, with DPR 1, 1.5 and 2 respectively. Each case exercises zoom 100%, 125% and 150%. Results are written to `artifacts/hybrid-checks.json`.

The nine cases check:

- DOM mention rectangles against owned geometry within 1.1 CSS pixels.
- Mention panel context and Escape focus return.
- Atomic arrow movement, selection, deletion, undo and typing before the mention.
- Copy and paste handlers using synthetic browser ClipboardEvents. This does not test the OS clipboard or its permissions.
- Block expansion, following-paragraph placement, checkbox and note persistence after unmounting.
- Focused widget pinning and unmounting after blur.
- Unchanged shaping counts during comment replies, checklist edits and scrolling.
- Rejection of unsupported scripts and combining marks attached directly to an inline atom, without losing the document.

Each case also runs 244 direct assertions against real shaping and layout. These cover atom-only paragraphs, adjacent atoms, atoms at both edges, narrow widths down to one pixel, styled recomposition, tall atoms, hit testing and snapshots retained after replacement and release.

The fixture has 164 blocks, including 15 checklists. At the bottom of each tested viewport only one checklist remains mounted after focus is released. This demonstrates virtualization and invalidation behavior, not a large-document performance benchmark.

The existing block regression suite passes 108,784 assertions per browser. The existing viewport suite checks pixel equality and glyph overflow clipping after normal and inline composition were changed to share the font ink-bounds helper. Screenshots were inspected for the desktop document and the narrow layout at 150% zoom.

## Deliberate limits

This is an integration study, not a public extension SDK or a complete editor. The proposed generic registry in `react-extensions.md` is not implemented. `CanvasPrimitive` registers a paint callback from a React component; it is not a React custom reconciler or a general canvas component library.

The mixed-block demo uses a placement adapter separate from the existing text-only block session. The default page loads its small fixture immediately. The stream=10000 variant now loads mixed blocks incrementally; see [large-document validation](hybrid-large-documents.md). It retains layout for all arrived paragraphs and still scans placement on several updates. React DOM state and layout run on the main thread.

The inline path assembles object clusters around atoms and then packs glyphs and carets. It does not yet use the direct packed-shaping decoder. Atom metric changes currently reshape the paragraph. All lines in an inline paragraph share a height large enough for its tallest atom, and the sample mention uses fixed declared dimensions. General per-line height and dynamic inline measurement remain work to do.

Input remains limited to the existing Latin left-to-right font set. There is no font fallback or complete IME/composition handling. Selection and arrow movement stay inside a paragraph. Enter does not create blocks. Multi-block selection, drag selection, cut, structured clipboard content and durable persistence are not implemented. Undo now stores per-block edits with a 256-record limit, so it preserves streamed arrivals. It does not group typing.

The React controls retain their DOM semantics, but the surrounding canvas document still needs an accessible reading and editing representation. DOM checklists are not included in a canvas-only export. No print/export fallback was implemented in this spike. These requirements need explicit extension contracts before a production registry is adopted.

## Assessment

Keep the hybrid approach. Layout geometry can remain owned and independent of React while ordinary components handle interactive controls. The [large-document study](hybrid-large-documents.md) now measures loading, rendering, reflow and memory with these extensions. Viewport-first reflow is now implemented and [validated separately](hybrid-viewport-reflow.md). Bounded offscreen layout retention remains the next priority before extracting a shared extension registry.
