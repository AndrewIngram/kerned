import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const raw=JSON.parse(await readFile('artifacts/owned-blocks-large.json','utf8'));
const checks=JSON.parse(await readFile('artifacts/owned-block-checks.json','utf8'));
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const rows=[];
for(const [browser,b] of Object.entries(raw.browsers)){
 assert.equal(b.cases.length,8);
 for(const c of b.cases){
  assert.equal(c.trials.length,3);assert.equal(c.errors.length,0);assert.ok(Object.values(c.validation.checks).every(Boolean));
  rows.push({browser,count:c.count,styled:c.styled,api:c.api,cold:median(c.trials.map(t=>t.cold.layoutMs)),first:median(c.trials.map(t=>t.streamed.firstSubmittedMs)),work:median(c.trials.map(t=>t.streamed.totalWorkMs)),last:median(c.trials.map(t=>t.streamed.samples.at(-1).updateMs)),worst:Math.max(...c.trials.flatMap(t=>t.streamed.samples.map(s=>s.updateMs))),edit:c.validation.editMs,unchanged:c.validation.unchangedMs,resize:c.validation.resizeMs});
 }
}
const lines=['# Block updates','',`Measured ${raw.recordedAt}, ${raw.cpu}.`,'','## Contract','',
 'A block document is an owned session. Each block is one Latin/LTR paragraph with local formatting ranges and no newline. A splice replaces a contiguous range of block positions. The session copies input spans, validates only the inserted/replaced blocks, prepares their layouts, then publishes the update atomically. Failed validation, native shaping or configuration leaves the previous snapshot and settings usable. Empty sessions render one implicit blank paragraph.','',
 '```ts',"const document = owned.createBlockDocument({ width: 480, size: 20 });", "let snapshot = document.splice(0, 0, firstChunk);", "snapshot = document.splice(document.blockCount, 0, nextChunk);", "snapshot = document.splice(12, 1, [editedParagraph]);", "snapshot = document.configure({ width: 320, size: 20 });", "snapshot = document.snapshot(); // read the published snapshot without rebuilding", "document.release(); // published snapshots remain usable",'```','',
 'A block is `{ text, spans }`; each span has local `start`, `end`, `bold` and `italic`. Ranges must be nonempty and end at grapheme boundaries. Overlaps are supported with the existing combined-style semantics. Width changes recompose all blocks without reshaping or revalidating them. Font-size changes reshape all blocks without repeating text validation. `release()` is idempotent; later reads or updates on that session throw. Engine `clear()` closes all block sessions as well as legacy document caches.','',
 'The block session module owns local validation, copied inputs, update order, rollback and lifetime. The engine owns the shared paragraph preparation and snapshot rendering. The whole-document API remains the comparison adapter and current UI path; it does not internally convert to block updates. The default renderer/storage selection is unchanged.','',
 '## Design choice and remaining costs','',
 'A stateless `layoutBlocks(allBlocks)` API would remove global formatting offsets but still require rescanning all inputs for changes. A stateful `splice(index, deleteCount, insertedBlocks)` API lets callers identify the changed range directly. The latter was chosen because chunk delivery and paragraph edits already identify that range. Positions refer to the current document; this is synchronous local editing, not a concurrent operation protocol with stable IDs or revisions.','',
 'This version still copies arrays of block references and rebuilds placement and flat line metadata after each splice. A one-block edit is therefore not O(1) overall. Drawing still visits all paragraphs. It does not implement viewport culling, workers, transport or a frame-budget scheduler. No new serialization boundary was added. Local validation removes full-document grapheme checks and repeated global span scans from the block path.','',
 '## Loading measurements','',
 'Both arms use direct packed shaping. Each browser/case uses a fresh page, a full-document warmup and three measured cold-cache/streamed trials. Whole and block paths run sequentially with order reversed for styled fixtures. This small sample is exploratory. Styled fixtures have two spans per paragraph; chunks contain 100 paragraphs for a 2,000-paragraph document and 500 for 10,000. Median milliseconds are shown; worst update is the maximum across all chunk trials.','',
 'Cold measures layout. First submission includes locally simulated JSON parsing, assembly where required, layout and draw/flush to a fixed 500×640 software canvas. It does not measure network latency or actual browser presentation. Total work excludes setTimeout yields between chunks. The block path consumes incoming block ranges without reconstructing full text/global spans.','',
 '| Browser | Paragraphs | Styled | API | Cold ms | First submission ms | Total stream work ms | Last update ms | Worst update ms |','|---|---:|---|---|---:|---:|---:|---:|---:|'];
for(const r of rows)lines.push(`| ${r.browser} | ${r.count} | ${r.styled?'yes':'no'} | ${r.api} | ${[r.cold,r.first,r.work,r.last,r.worst].map(n=>n.toFixed(1)).join(' | ')} |`);
lines.push('','## Update diagnostics','','Single observations after the stream trials, not timing distributions. `snapshot()` is a direct read in the block path. Edit changes one middle paragraph; resize changes 480px to 310px.','',
 '| Browser | Paragraphs | Styled | API | Unchanged/read ms | Edit ms | Resize ms |','|---|---:|---|---|---:|---:|---:|');
for(const r of rows)lines.push(`| ${r.browser} | ${r.count} | ${r.styled?'yes':'no'} | ${r.api} | ${[r.unchanged,r.edit,r.resize].map(n=>n.toFixed(1)).join(' | ')} |`);
lines.push('','## Memory','','Chromium post-GC samples after streaming, relative to a warmed/released baseline. JS used heap plus backing stores, decimal MB; not total browser or peak memory. Backing stores include external strings as well as ArrayBuffers. Small release residuals are reported rather than treated as retained documents.','',
 '| Paragraphs | Styled | API | Loaded MB | Released MB | Released backing bytes |','|---:|---|---|---:|---:|---:|');
for(const c of raw.browsers.chromium.cases){
 const {baseline,loaded,released}=c.memory;
 assert.equal(loaded.state.retention.paragraphVariants,c.count);assert.equal(released.state.retention.documents,0);assert.equal(released.state.snapshot,false);
 const delta=s=>(s.heap.usedSize+s.heap.backingStorageSize-baseline.heap.usedSize-baseline.heap.backingStorageSize)/1e6;
 lines.push(`| ${c.count} | ${c.styled?'yes':'no'} | ${c.api} | ${delta(loaded).toFixed(2)} | ${delta(released).toFixed(2)} | ${released.heap.backingStorageSize-baseline.heap.backingStorageSize} |`);
}
lines.push('','## Verification','','Large-document tests compare streamed, edited and resized snapshots with cold whole-document layouts, including complete line metadata, sampled caret/hit/navigation results and top/middle/bottom pixels. Counters verify that block appends validate only incoming blocks, an edit validates one block, and resize validates none. Both APIs preserve old snapshots.','',
 '| Browser | Focused API assertions | Failed check groups |','|---|---:|---:|');
for(const [browser,c] of Object.entries(checks)){assert.ok(Object.values(c.checks).every(Boolean));assert.equal(c.errors.length,0);lines.push(`| ${browser} | ${c.assertions} | 0 |`);}
lines.push('','Focused checks cover widths 1/120/333.3/2400 and sizes 8/20/72, empty and blank paragraphs, overlapping formatting, insert/replace/delete, width/font-size changes, invalid ranges, grapheme-splitting formatting, failed multi-block updates, native missing-glyph failure, caller mutation, independent sessions, engine clear, repeated release and snapshot lifetime.','',
 '## Assessment','','Block-local updates remove most of the styled-document processing overhead in these tests, while retaining similar memory use. Initial chunk work still includes shaping its contents, and 500-paragraph styled chunks exceed a 16ms frame budget. Placement rebuilding and whole-document drawing remain measurable. The next experiment should cull drawing to visible paragraphs and adapt chunk sizes to a time budget; a persistent placement index can follow if profiling shows the remaining document-wide work dominates.','',
 '## Reproduce','','Build with `npm run build:owned`, serve the owned production preview on port 5175, then run `node scripts/check-owned-blocks.mjs`, `node scripts/check-owned-blocks-large.mjs`, and `node scripts/report-owned-blocks.mjs`. `OWNED_URL` selects another server. Raw results: `artifacts/owned-block-checks.json`, `artifacts/owned-blocks-large.json`. Loading/update summary: `artifacts/owned-block-summary.json`.','');
await writeFile('docs/owned-block-updates.md',lines.join('\n'));
await writeFile('artifacts/owned-block-summary.json',JSON.stringify(rows,null,2)+'\n');
console.log('Verified and reported',rows.length,'cases');
