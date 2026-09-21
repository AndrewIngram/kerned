import {readFile,writeFile} from 'node:fs/promises';
const benchmark=JSON.parse(await readFile('artifacts/editor-reflow-benchmark.json','utf8'));
const checks=JSON.parse(await readFile('artifacts/editor-reflow-checks.json','utf8'));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const f=n=>n.toFixed(1);
const rows=[];
for(const browser of ['chromium','firefox','webkit']){
 const eager=benchmark.trials.filter(t=>t.browser===browser&&t.mode==='eager');
 const viewport=benchmark.trials.filter(t=>t.browser===browser&&t.mode==='viewport');
 if(eager.length!==3||viewport.length!==3)throw new Error('Expected three trials per mode/browser');
 rows.push(`| ${browser} | ${f(median(eager.map(t=>t.firstPaintMs)))} | ${f(median(viewport.map(t=>t.firstPaintMs)))} | ${f(median(viewport.map(t=>t.completeMs)))} | ${f(Math.max(...eager.map(t=>t.frameMaxMs)))} | ${f(Math.max(...viewport.map(t=>t.frameMaxMs)))} |`);
}
const progressive=benchmark.trials.filter(t=>t.mode==='viewport');
const counts=progressive.map(t=>t.initialLayouts);const initialCount=Math.min(...counts)===Math.max(...counts)?String(counts[0]):`${Math.min(...counts)}–${Math.max(...counts)}`;
const batchWork=progressive.flatMap(t=>t.batches.filter(b=>b.background).map(b=>b.workMs)).sort((a,b)=>a-b);
const text=`# Viewport-first reflow

Recorded ${benchmark.recordedAt} on ${benchmark.cpu}. The editor editor now reflows visible paragraphs before processing offscreen paragraphs in frame-sized batches. No new dependencies, worker transport or WASM interface were added.

## Result

A width change synchronously lays out the viewport, its overscan and pinned selection/panel paragraphs. The remaining paragraphs temporarily retain their previous heights. Their geometry is recomputed in the background while the visible block keeps its screen position. A newer width replaces the pending work for the old width.

For the 10,000-block fixture, the first phase composed ${initialCount} paragraphs instead of 8,999. The paired runs use the same build and fixture, changing the browser viewport from 1,100 to 700 pixels while scrolled to the middle. The editor's content width changes from 742 to 610 CSS pixels. Each browser has three trials per mode, with mode order alternated.

| Browser | Synchronous first paint, ms | Viewport-first paint, ms | Background completion, ms | Worst synchronous frame interval, ms | Worst viewport-first frame interval, ms |
|---|---:|---:|---:|---:|---:|
${rows.join('\n')}

First paint and completion columns are medians across three trials. Frame columns are the worst sampled interval across those trials. Paint timing starts when scene reflow begins and ends at CanvasKit flush; it excludes the browser's delay before ResizeObserver dispatch and is not a compositor presentation timestamp. Frame intervals are sampled independently around the resize.

Offscreen completion deliberately takes longer because work yields between frames. Background composition targets 4 ms and stops after at most 128 paragraphs per batch. Across these runs, the full scene-build work for background batches had median ${f(median(batchWork))} ms, p95 ${f(batchWork[Math.floor(batchWork.length*.95)])} ms and maximum ${f(batchWork.at(-1))} ms. Each batch measurement covers one scene-build call, including placement rebuilding. It excludes subsequent React reconciliation, measurement/anchor follow-up renders and canvas painting. The 4 ms target is not a hard time limit: a single paragraph, allocation or garbage collection can overrun it.

Raw data: [paired timings](../artifacts/editor-reflow-benchmark.json), [correctness results](../artifacts/editor-reflow-checks.json).

## Correctness

All ${checks.length} reflow scenarios pass across Chromium, Firefox and WebKit. Six exercise 2,000/10,000-block documents; three load and edit a 10,000-block document concurrently with reflow. The existing nine small-editor scenarios and nine large-document scenarios also pass.

Checks cover:

- Current-width layout for the viewport before the remaining document finishes.
- Scroll-anchor preservation during the first phase and at background completion.
- Changing width again before the previous generation finishes, returning to a cached width without redoing the entire document, then zooming.
- Jumping into an unfinished region, editing it and undoing the edit.
- Focused widget retention and ResizeObserver updates during reflow.
- Incoming chunks and edits while width work is pending.
- No visible/pinned old-width paragraph reaching the tracked draw stage.
- Final block positions, line/caret geometry and inline boxes matching a fresh engine's eager layout of every paragraph.

The eager reference is separate from the scene scheduler. It uses a new owned engine and the same final document data, target width and widget measurements, so it also checks that superseded jobs did not publish outdated text or dimensions. Existing snapshots retain immutable placements and layout objects.

A 420-pixel Chromium viewport was also inspected during reflow with more than 8,700 paragraphs still pending. Its screenshot was byte-identical to the screenshot after background completion, confirming stable visible output in that case.

## Implementation

The scene cache owns a set of paragraphs awaiting the target width. Each pass first prepares newly inserted/edited text and visible or pinned paragraphs. It walks forward using newly computed heights so wider lines cannot expose an unprepared paragraph at the bottom of the viewport. A scheduled background pass then composes a bounded set of remaining paragraphs and publishes updated positions.

Scroll anchoring uses a block and its offset inside the previous layout. Height changes above that block adjust scrollTop. The offset is clamped if the anchor block becomes shorter. Paragraphs entering the viewport during background work are promoted immediately. Selection and open panels also pin their paragraph's current-width layout.

React schedules one background pass per animation frame. Width changes supersede the pending set rather than queueing jobs with captured old widths. The ordinary settled scrolling path still skips document-wide layout work. Canvas and DOM placement consume the same scene.

## Reproduce

~~~sh
npm run build
npm run preview
npm run check:editor-reflow
npm run benchmark:editor-reflow
node scripts/report-editor-reflow.mjs
~~~

Open [the 10,000-block demo](http://127.0.0.1:5176/extensions.html?stream=10000). Add reflow=eager to the query to run the synchronous comparison path. The default small demo also uses viewport-first reflow.

## Limits and next step

The document's total height and scrollbar thumb can change while offscreen paragraphs converge. Measurements for unmounted DOM blocks remain estimates. A single very large paragraph still composes synchronously. These results use the existing Latin/styled fixture and local chunk source, not a real network stream or complex-script editor.

The scene still scans/copies placement arrays during reflow, and retains shaping and layout for all arrived paragraphs. This change does not solve the retained-memory cost measured in the [large-document study](editor-large-documents.md). The next useful step is bounded offscreen layout retention and compact caret storage, while preserving enough height information for stable scrolling.
`;
await writeFile('docs/editor-viewport-reflow.md',text);
