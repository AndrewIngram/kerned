import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const raw=JSON.parse(await readFile('artifacts/owned-large-documents.json','utf8'));
const fragments=JSON.parse(await readFile('artifacts/owned-fragment-loading.json','utf8'));
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const n=x=>x.toFixed(1);
const lines=['# Large documents and incremental loading','',`Recorded ${raw.recordedAt}, ${raw.cpu}.`,'',
 '## What was tested','',
 '2,000 and 10,000 distinct paragraphs, roughly 116 characters each, at 20px with 480px text width. Styled fixtures have two spans per paragraph and five font runs, plus the base shaping call used for line breaks. Both variants use packed carets; `shaping` also decodes directly into packed glyph/cluster storage. The editor default is unchanged.','',
 'Each case uses one fresh page and engine, an untimed full-document warmup, then three cold-cache and streamed trials. Cases run sequentially; variant order reverses between plain and styled fixtures. This is a small exploratory sample, not a statistical regression gate. Cold timings exclude fixture construction, transport, font download and WASM initialization. Streaming times include JSON parsing of locally generated chunks, reconstruction of full text and spans, layout, canvas drawing and flush. Chunks contain completed paragraphs: 100 at a time for 2,000 paragraphs and 500 for 10,000. Each delivery yields with setTimeout(0). There is no network simulation.','',
 'Rendering uses a fixed 500×640 CanvasKit software surface. First submission means the first chunk has been drawn and flushed; it is not a browser presentation/FCP measurement. Draw timings exclude PNG encoding. The existing draw method still submits every paragraph, even outside the surface. These tests measure clipping, not viewport culling.','',
 '## Loading','',
 'Median over three trials, milliseconds. Cold is layout alone; first submission includes parsing, assembly, layout and drawing. Work sums chunk-update durations, excluding between-chunk yields. Last update shows accumulated-document overhead. Worst is the slowest individual update across all trials.','',
 '| Browser | Paragraphs | Styled | Storage | Cold layout | First submission | Total stream work | Final submission elapsed | Last update | Worst update |','|---|---:|---|---|---:|---:|---:|---:|---:|---:|'];
const summary=[];
for(const [browser,b] of Object.entries(raw.browsers)) {
 assert.equal(b.cases.length,8);
 for(const c of b.cases){
  assert.equal(c.trials.length,3);assert.equal(c.errors.length,0);assert.ok(Object.values(c.validation.checks).every(Boolean));
  const row={browser,count:c.count,styled:c.styled,storage:c.storage,cold:median(c.trials.map(t=>t.cold.layoutMs)),first:median(c.trials.map(t=>t.streamed.firstSubmittedMs)),work:median(c.trials.map(t=>t.streamed.totalWorkMs)),elapsed:median(c.trials.map(t=>t.streamed.finalSubmittedMs)),last:median(c.trials.map(t=>t.streamed.samples.at(-1).updateMs)),worst:Math.max(...c.trials.flatMap(t=>t.streamed.samples.map(s=>s.updateMs)))};
  summary.push(row);
  lines.push(`| ${browser} | ${c.count} | ${c.styled?'yes':'no'} | ${c.storage} | ${[row.cold,row.first,row.work,row.elapsed,row.last,row.worst].map(n).join(' | ')} |`);
 }
}
lines.push('','## Update and draw diagnostics','','Single observations after the loading trials, not timing distributions. Top/middle/bottom draws use the same fixed-size surface. Unchanged and edit timings include the current whole-document input processing.','',
 '| Browser | Paragraphs | Styled | Storage | Unchanged ms | One-paragraph edit ms | Resize ms | Top / middle / bottom draw ms |','|---|---:|---|---|---:|---:|---:|---|');
for(const [browser,b] of Object.entries(raw.browsers))for(const c of b.cases){const v=c.validation;lines.push(`| ${browser} | ${c.count} | ${c.styled?'yes':'no'} | ${c.storage} | ${n(v.unchangedMs)} | ${n(v.editMs)} | ${n(v.resizeMs)} | ${v.viewportDrawMs.map(n).join(' / ')} |`);}
lines.push('','## Retained memory','','Chromium only. One post-GC sample per case after all three stream trials. Baseline follows a full-document warmup and cache release. Values are JS used heap plus backing stores relative to baseline, in decimal MB; this is not total browser/native/GPU memory or peak memory. Fixture text and spans already exist at baseline.','',
 '| Paragraphs | Styled | Storage | Retained MB | After release MB | Backing-store delta after release |','|---:|---|---|---:|---:|---:|');
for(const c of raw.browsers.chromium.cases){
 const {baseline,loaded,released}=c.memory;
 assert.equal(loaded.state.retention.paragraphVariants,c.count);
 assert.equal(released.state.retention.documents,0);assert.equal(released.state.snapshot,false);
 assert.equal(released.heap.backingStorageSize,baseline.heap.backingStorageSize);
 const total=s=>(s.heap.usedSize+s.heap.backingStorageSize-baseline.heap.usedSize-baseline.heap.backingStorageSize)/1e6;
 lines.push(`| ${c.count} | ${c.styled?'yes':'no'} | ${c.storage} | ${total(loaded).toFixed(2)} | ${total(released).toFixed(2)} | 0 |`);
}
lines.push('','## Correctness','','All cases check that only newly arrived paragraphs shape and compose, unchanged inputs reuse all shaping/composition, one edit changes one paragraph, and resizing reuses shaping. Full line metadata, sampled carets/hit tests/navigation, and top/middle/bottom viewport pixels match separate cold layouts. Old snapshots remain usable. These checks compare execution paths of the same engine; the earlier size suite separately compares implementations and reference widths.','',
 'Additional fragment tests load 40 paragraphs in variable character chunks, including splits inside words, formatting ranges and a combining-accent sequence. They check bounded recomposition, final geometry/pixels versus cold loading, and old snapshot stability. They do not cover incomplete UTF-8 byte sequences or split UTF-16 surrogate pairs.','',
 '| Browser | Fragment cases | Chunks per case | Checks passed |','|---|---:|---:|---:|');
for(const [browser,cases] of Object.entries(fragments)){
 assert.equal(cases.length,4);assert.ok(cases.every(c=>Object.values(c.checks).every(Boolean)));
 lines.push(`| ${browser} | ${cases.length} | ${cases[0].chunks} | ${cases.reduce((n,c)=>n+Object.keys(c.checks).length,0)} |`);
}
lines.push('','## Assessment','','Packed shaping preserves its memory advantage for larger styled documents. Incremental input produces an early rendered chunk and reuses previous shaping, but repeated full-prefix submissions still do substantial work. Later updates become expensive as the loaded prefix grows. The current API is not yet suitable for smooth large styled-document loading.','',
 'Source inspection identifies full-document grapheme validation and a scan of every formatting span for every paragraph. The latter scales with paragraph count times span count. Document placement and flat line metadata are also rebuilt on each update. Cache counters prove shaping/composition reuse; they do not imply the rest of the update is cheap. These observations identify targets, not a measured CPU attribution breakdown.','',
 'The next step is a paragraph/block update API with local formatting ranges, so append/edit operations validate and inspect only changed blocks. A viewport draw path should visit only intersecting paragraphs. Chunk work should then be scheduled against a time budget; the fixed-size chunks here are intentionally a measurement baseline. This can remain in TypeScript and does not require another serialization boundary.','',
 '## Reproduce','','Build with `npm run build:owned` and serve the owned preview on port 5175. Run `node scripts/check-owned-large.mjs`, `node scripts/check-owned-fragments.mjs`, then `node scripts/report-owned-large.mjs`. Set `OWNED_URL` for another server. Raw results are `artifacts/owned-large-documents.json` and `artifacts/owned-fragment-loading.json`; summarized loading timings are `artifacts/owned-large-summary.json`.','');
await writeFile('docs/owned-large-documents.md',lines.join('\n'));
await writeFile('artifacts/owned-large-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log('Validated and reported',summary.length,'large-document cases.');
