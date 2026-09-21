import { readFile, writeFile } from 'node:fs/promises';

const benchmark = JSON.parse(await readFile('artifacts/editor-large-benchmark.json', 'utf8'));

const checks = JSON.parse(await readFile('artifacts/editor-large-checks.json', 'utf8'));

const median = (a) => [...a].toSorted((aValue, b) => aValue - b)[Math.floor(a.length / 2)];

const f = (n) => n.toFixed(1),
  mb = (n) => (n / 1e6).toFixed(1);

const rows = [];

for (const browser of ['chromium', 'firefox', 'webkit'])
  for (const total of [2000, 10000]) {
    const t = benchmark.trials.filter((t) => t.browser === browser && t.total === total);
    rows.push(
      `| ${browser} | ${total.toLocaleString('en-US')} | ${f(median(t.map((tValue) => tValue.firstCanvasFlushMs)))} | ${f(median(t.map((tValue2) => tValue2.loadAfterMountMs)))} | ${f(median(t.map((tValue3) => tValue3.chunkWorkMs.p95)))} | ${f(Math.max(...t.map((tValue4) => tValue4.frameGapMs.max)))} |`,
    );
  }

const resizing = checks.cases
  .filter((c) => c.total === 10000)
  .map((c) => `| ${c.browser} | ${c.width} | ${f(c.widthChanges.at(-1).workMs)} |`);

const memory = benchmark.memory.map(
  (m) =>
    `| ${m.total.toLocaleString('en-US')} | ${mb(m.delta.usedSize)} | ${mb(m.delta.backingStorageSize)} | ${mb(m.buffers.caretUnusedBytes)} |`,
);

const doc = `# Large editor documents

For the current viewport-first resize implementation and paired timing comparisons, see [viewport-first reflow](editor-viewport-reflow.md).

Recorded ${benchmark.recordedAt} on ${benchmark.cpu}. Production build, local Vite preview, headless Chromium, Firefox and WebKit. Browser versions and raw measurements are in [the benchmark artifact](../artifacts/editor-large-benchmark.json); correctness results are in [the check artifact](../artifacts/editor-large-checks.json).

## Result

Incremental loading works with the editor extensions. The first 32 blocks are editable before the remaining blocks are generated. Background arrival preserves text edits, selection, focus, widget state and undo history. Rendering and DOM mounting stay bounded by the viewport.

The remaining costs are whole-document reflow and retained layout. Width changes now prioritize the viewport and batch offscreen composition; see the reflow report for complete timing comparisons. The editor retains shaping and geometry for every loaded paragraph, even when its React elements are unmounted.

## Reproduce

~~~sh
pnpm run build
pnpm run preview
node scripts/check-editor-large.mjs
node scripts/benchmark-editor-large.mjs
node scripts/report-editor-large.mjs
~~~

Open [/extensions.html?stream=10000](http://127.0.0.1:5176/extensions.html?stream=10000). The default page remains the small extension study. The stream parameter accepts 32 through 10,000 blocks. The test-only paused=1 option holds loading after the first 32 blocks; window.editorDiagnostics.resume() continues it. slowImages=1 extends the image decode delay for reflow checks.

The fixture is generated locally, one requested chunk at a time. This tests incremental document ingestion, layout, React updates and painting. It does **not** measure network transport, server parsing, real download latency or arbitrary external content. It uses styled Latin paragraphs, atomic mentions, comments, a table and images. At 10,000 blocks there are 9,499 paragraphs, one table and 500 image blocks. The images share one SVG resource; these numbers do not describe 500 distinct decoded photographs.

## Loading measurements

Each browser/size has three independent page contexts. Columns show medians across trials, except the last column, which is the worst observed frame interval across all three trials.

| Browser | Blocks | First canvas flush, ms | Load after React mount, ms | Median trial p95 chunk work, ms | Worst loading frame interval, ms |
|---|---:|---:|---:|---:|---:|
${rows.join('\n')}

First canvas flush is measured from the navigation time origin and includes local asset loading and engine initialization. It is a proxy for the first usable viewport, not a browser compositor presentation timestamp. Every trial first rendered 32 blocks. Load duration includes frame yields and ends when the last chunk has been painted; it does not mean every offscreen image has decoded.

The loader starts with 32 blocks per chunk and adjusts subsequent batches between 8 and 128 toward an 8 ms work target. It waits for a committed canvas paint before requesting the next chunk. Work includes fixture generation, measured React render/commit passes and canvas drawing. It excludes idle frame waiting and does not fully account for browser style/layout work outside those passes. Frame intervals provide a separate responsiveness check. The target is not a hard deadline, and garbage collection or a large synchronous update can exceed it.

Clean timing runs remain at the top of the document without interaction. Correctness runs deliberately pause, edit, scroll and force delayed image loads, and are not used for loading-duration comparisons. Memory sampling runs separately, so forced GC cannot affect the timing table.

## Interaction and reflow checks

All ${checks.cases.length} large-document cases passed: 2,000 blocks at a 1,100-pixel viewport, and 10,000 blocks at 1,100 and 420 pixels, in each browser. The narrow cases use DPR 1.5. The original nine-case editor suite also passes, including DPR 2 and 150% zoom.

The large cases verify:

- Typing while chunks are arriving, followed by undo/redo without removing new blocks.
- Unchanged existing paragraph geometry on append and layout calls limited to incoming paragraphs.
- Focus and selection preservation during loading.
- Delayed image decode, resulting block height and following-paragraph position.
- A focused table resized above the viewport without moving the visible anchor.
- Widget notes surviving loading and virtualization.
- Bounded mounts and unchanged shaping/layout counts on scrolling.
- One-paragraph invalidation for a styled edit, undo restoration, and a combining mark typed at a formatting boundary.
- Width changes reusing shaping and preserving the current block's screen offset.

The test grows a textarea through its DOM style to exercise the real ResizeObserver and placement path. It does not automate dragging the browser's resize grip. Sampled scroll positions include the start, middle and end. At most ${Math.max(...checks.cases.map((c) => c.maxMounted))} custom block components were mounted, including focused blocks retained outside the viewport. At most ${Math.max(...checks.cases.map((c) => c.maxSubmitted))} text paragraphs were submitted per draw. These are observed counts for this fixture, not universal limits.

Edit timing in the raw check artifact starts at the local edit commit and ends at the next canvas flush. It includes frame scheduling but excludes the browser input queue and earlier input processing; it is not a complete input-latency benchmark.

Canvas and DOM output were visually inspected in the completed document at desktop and narrow widths, including the loaded image and the mention panel.

### Whole-document resizing

These are single measured first-phase scene rebuilds from the correctness runs, not repeated timing medians. On the current build, remaining offscreen work finishes later. A desktop viewport changes from 1,100 to 700 pixels; the narrow viewport changes from 420 to 520 pixels. The loaded document contains 10,000 blocks. Shaping counts remain unchanged. The first phase prepares the visible paragraphs; the paired reflow report also measures background completion.

| Browser | Initial viewport width | Scene rebuild, ms |
|---|---:|---:|
${resizing.join('\n')}

Viewport-first reflow is now implemented. See its separate report for before/after responsiveness and completion times.

## Retained memory

Chromium CDP measurements after two forced collections, relative to the same page paused with 32 blocks. There is one memory trial per size. Values are decimal MB. JavaScript heap and backing storage are separate reported categories; neither is total browser process memory.

| Blocks | Additional JS heap, MB | Additional backing storage, MB | Unused retained caret capacity, MB |
|---|---:|---:|---:|
${memory.join('\n')}

At 10,000 blocks the engine accounts for about ${mb(benchmark.memory.at(-1).buffers.shapingBufferBytes)} MB of shaping buffers, ${mb(benchmark.memory.at(-1).buffers.glyphBufferBytes)} MB of glyph buffers and ${mb(benchmark.memory.at(-1).buffers.caretBufferBytes)} MB of caret buffers. These engine-side buffer counts are not an independent measurement of total browser memory. Backing storage also includes the existing WASM memory. Native CanvasKit allocations, browser DOM memory and decoded images are not fully described by these figures.

Culling reduces drawing and mounted DOM, but does not evict offscreen shaping or layout. Compacting unused caret capacity and retaining detailed geometry only near the viewport are worthwhile follow-ups. The current typed arrays already avoid new serialization boundaries; typed arrays alone do not imply SIMD execution.

## Implementation changes

- Added styled, mixed-block chunk generation and a frame-yielding producer with paint acknowledgement.
- Extracted the scene cache. Append reuses the unchanged placement prefix; cache checks compare text and immutable style/atom references instead of JSON-serializing every paragraph.
- Replaced whole-document undo snapshots with bounded per-block edit records. Incoming content is not part of local edit undo.
- Added measured image blocks and retained decoded image dimensions.
- Preserved the visible block and its offset across measurement, width and zoom changes.
- Added loading, canvas, frame, edit-to-paint and cache diagnostics for reproducible checks.

Placement arrays and block arrays still scan or copy in several updates; this is not yet a tree-backed document store. Per-paragraph layout is retained eagerly as each chunk arrives. The extension demo remains separate from the text-only block session and the original streaming experiment. Full IME support, cross-block selection, accessibility for canvas text and DOM-widget export remain open work.
`;

await writeFile('docs/editor-large-documents.md', doc);
