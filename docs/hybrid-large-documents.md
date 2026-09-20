# Large hybrid documents

This is the initial loading and memory study. [Retained geometry](hybrid-retained-geometry.md) now supersedes its memory measurements. Width changes now use [viewport-first reflow](hybrid-viewport-reflow.md); its paired benchmark supersedes the synchronous resize measurements below. The [book loading study](editor-loading-performance.md) documents the updated batch controller, which targets new paragraph composition rather than total render work.

Recorded 2026-09-19T15:17:14.919Z on Apple M4 Pro. Production build, local Vite preview, headless Chromium, Firefox and WebKit. Browser versions and raw measurements are in [the benchmark artifact](../artifacts/hybrid-large-benchmark.json); correctness results are in [the check artifact](../artifacts/hybrid-large-checks.json).

## Result

Incremental loading works with the hybrid extensions. The first 32 blocks are editable before the remaining blocks are generated. Background arrival preserves text edits, selection, focus, widget state and undo history. Rendering and DOM mounting stay bounded by the viewport.

The remaining costs are whole-document reflow and retained layout. At the time of this baseline, width changes recomposed all loaded paragraphs synchronously. The viewport-first implementation now batches that work. The editor retains shaping and geometry for every loaded paragraph, even when its React elements are unmounted.

## Reproduce

~~~sh
npm run build
npm run preview
node scripts/check-hybrid-large.mjs
node scripts/benchmark-hybrid-large.mjs
node scripts/report-hybrid-large.mjs
~~~

Open [/hybrid-editor.html?stream=10000](http://127.0.0.1:5176/hybrid-editor.html?stream=10000). The default page remains the small extension study. The stream parameter accepts 32 through 10,000 blocks. The test-only paused=1 option holds loading after the first 32 blocks; window.hybridSpike.resume() continues it. slowImages=1 extends the image decode delay for reflow checks.

The fixture is generated locally, one requested chunk at a time. This tests incremental document ingestion, layout, React updates and painting. It does **not** measure network transport, server parsing, real download latency or arbitrary external content. It uses styled Latin paragraphs, atomic mentions, comments, checklists and images. At 10,000 blocks there are 8,999 paragraphs, 501 checklists and 500 image blocks. The images share one SVG resource; these numbers do not describe 500 distinct decoded photographs.

## Loading measurements

Each browser/size has three independent page contexts. Columns show medians across trials, except the last column, which is the worst observed frame interval across all three trials.

| Browser | Blocks | First canvas flush, ms | Load after React mount, ms | Median trial p95 chunk work, ms | Worst loading frame interval, ms |
|---|---:|---:|---:|---:|---:|
| chromium | 2,000 | 88.2 | 361.6 | 9.6 | 16.7 |
| chromium | 10,000 | 88.0 | 1530.9 | 8.5 | 16.8 |
| firefox | 2,000 | 106.0 | 472.0 | 10.0 | 17.4 |
| firefox | 10,000 | 105.0 | 1932.0 | 11.0 | 17.5 |
| webkit | 2,000 | 143.0 | 374.0 | 9.0 | 34.0 |
| webkit | 10,000 | 148.0 | 1492.0 | 9.0 | 22.0 |

First canvas flush is measured from the navigation time origin and includes local asset loading and engine initialization. It is a proxy for the first usable viewport, not a browser compositor presentation timestamp. Every trial first rendered 32 blocks. Load duration includes frame yields and ends when the last chunk has been painted; it does not mean every offscreen image has decoded.

The loader starts with 32 blocks per chunk and adjusts subsequent batches between 8 and 128 toward an 8 ms work target. It waits for a committed canvas paint before requesting the next chunk. Work includes fixture generation, measured React render/commit passes and canvas drawing. It excludes idle frame waiting and does not fully account for browser style/layout work outside those passes. Frame intervals provide a separate responsiveness check. The target is not a hard deadline, and garbage collection or a large synchronous update can exceed it.

Clean timing runs remain at the top of the document without interaction. Correctness runs deliberately pause, edit, scroll and force delayed image loads, and are not used for loading-duration comparisons. Memory sampling runs separately, so forced GC cannot affect the timing table.

## Interaction and reflow checks

All 9 large-document cases passed: 2,000 blocks at a 1,100-pixel viewport, and 10,000 blocks at 1,100 and 420 pixels, in each browser. The narrow cases use DPR 1.5. The original nine-case hybrid suite also passes, including DPR 2 and 150% zoom.

The large cases verify:

- Typing while chunks are arriving, followed by undo/redo without removing new blocks.
- Unchanged existing paragraph geometry on append and layout calls limited to incoming paragraphs.
- Focus and selection preservation during loading.
- Delayed image decode, resulting block height and following-paragraph position.
- A focused checklist resized above the viewport without moving the visible anchor.
- Widget notes surviving loading and virtualization.
- Bounded mounts and unchanged shaping/layout counts on scrolling.
- One-paragraph invalidation for a styled edit, undo restoration, and a combining mark typed at a formatting boundary.
- Width changes reusing shaping and preserving the current block's screen offset.

The test grows a textarea through its DOM style to exercise the real ResizeObserver and placement path. It does not automate dragging the browser's resize grip. Sampled scroll positions include the start, middle and end. At most 3 custom block components were mounted, including focused blocks retained outside the viewport. At most 8 text paragraphs were submitted per draw. These are observed counts for this fixture, not universal limits.

Edit timing in the raw check artifact starts at the local edit commit and ends at the next canvas flush. It includes frame scheduling but excludes the browser input queue and earlier input processing; it is not a complete input-latency benchmark.

Canvas and DOM output were visually inspected in the completed document at desktop and narrow widths, including the loaded image and the mention panel.

### Whole-document resizing

These are single measured scene rebuilds from the correctness runs, not repeated timing medians. A desktop viewport changes from 1,100 to 700 pixels; the narrow viewport changes from 420 to 520 pixels. The loaded document contains 10,000 blocks. Shaping counts remain unchanged, but every paragraph is recomposed at the new width.

| Browser | Initial viewport width | Scene rebuild, ms |
|---|---:|---:|
| chromium | 1100 | 150.3 |
| chromium | 420 | 156.4 |
| firefox | 1100 | 173.0 |
| firefox | 420 | 174.0 |
| webkit | 1100 | 131.0 |
| webkit | 420 | 134.0 |

These pauses are visible enough to justify the next optimization: reflow the viewport and its overscan first, then update the rest in bounded batches while retaining a stable anchor. No worker or new WASM boundary is needed to test that approach.

## Retained memory

Chromium CDP measurements after two forced collections, relative to the same page paused with 32 blocks. There is one memory trial per size. Values are decimal MB. JavaScript heap and backing storage are separate reported categories; neither is total browser process memory.

| Blocks | Additional JS heap, MB | Additional backing storage, MB | Unused retained caret capacity, MB |
|---|---:|---:|---:|
| 2,000 | 13.6 | 21.3 | 3.8 |
| 10,000 | 67.0 | 108.7 | 18.9 |

At 10,000 blocks the engine accounts for about 63.8 MB of shaping buffers, 11.3 MB of glyph buffers and 34.0 MB of caret buffers. These engine-side buffer counts are not an independent measurement of total browser memory. Backing storage also includes the existing WASM memory. Native CanvasKit allocations, browser DOM memory and decoded images are not fully described by these figures.

Culling reduces drawing and mounted DOM, but does not evict offscreen shaping or layout. Compacting unused caret capacity and retaining detailed geometry only near the viewport are worthwhile follow-ups. The current typed arrays already avoid new serialization boundaries; typed arrays alone do not imply SIMD execution.

## Implementation changes

- Added styled, mixed-block chunk generation and a frame-yielding producer with paint acknowledgement.
- Extracted the scene cache. Append reuses the unchanged placement prefix; cache checks compare text and immutable style/atom references instead of JSON-serializing every paragraph.
- Replaced whole-document undo snapshots with bounded per-block edit records. Incoming content is not part of local edit undo.
- Added measured image blocks and retained decoded image dimensions.
- Preserved the visible block and its offset across measurement, width and zoom changes.
- Added loading, canvas, frame, edit-to-paint and cache diagnostics for reproducible checks.

Placement arrays and block arrays still scan or copy in several updates; this is not yet a tree-backed document store. Per-paragraph layout is retained eagerly as each chunk arrives. The extension demo remains separate from the text-only block session and the original streaming experiment. Full IME support, cross-block selection, accessibility for canvas text and DOM-widget export remain open work.
