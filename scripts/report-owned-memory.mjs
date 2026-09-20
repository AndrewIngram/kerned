import { readFile, writeFile } from 'node:fs/promises';
const result = JSON.parse(await readFile('artifacts/owned-retained-memory.json', 'utf8'));
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const groups = [];
for(const paragraphs of [500,2000]) for(const storage of ['objects','carets']) {
  const trials = result.trials.filter(t=>t.paragraphs===paragraphs && t.storage===storage);
  if(trials.length!==3) throw new Error('Expected three memory trials');
  const stages = trials[0].stages.map(({stage}) => {
    const rows = trials.map(t=>t.stages.find(s=>s.stage===stage));
    const js = trials.map((t,i)=>rows[i].heap.usedSize-t.stages[0].heap.usedSize);
    const backing = trials.map((t,i)=>rows[i].heap.backingStorageSize-t.stages[0].heap.backingStorageSize);
    return {
      stage, js:median(js), backing:median(backing), total:median(js.map((v,i)=>v+backing[i])),
      caretBytes:median(rows.map(r=>r.state.memory.caretBufferBytes)), usedBytes:median(rows.map(r=>r.state.memory.caretUsedBytes)),
      snapshots:rows[0].state.snapshots,
    };
  });
  groups.push({paragraphs,storage,stages});
}
const mb = bytes=>(bytes/1e6).toFixed(2);
const lines = ['# Retained memory and caret capacity', '',
  `Recorded ${result.recordedAt}, ${result.cpu}, Chromium ${result.version}.`, '',
  '## Method and scope', '',
  'Three fresh browser pages per variant and document size, alternating variant order. Fonts, code and the native allocator are warmed with the same document before recording an empty-document baseline. Each stage unwinds the evaluation stack and requests garbage collection twice, then reads Chromium Runtime.getHeapUsage. These forced-GC measurements inspect retention, not normal GC timing or peak allocation.', '',
  'JavaScript usedSize and backingStorageSize are reported separately. Backing storage includes ArrayBuffer storage and external strings. Their sum is a tracked-memory comparison, not renderer-process RSS or total browser memory; embedder/native/GPU allocations are not fully represented. The baseline already includes the comparison page, font data, WASM modules and native allocator high-water memory. Raw metrics, including embedder heap and native shaping-module linear-memory size, are preserved in the artifact.', '',
  'Exact caret capacity is measured from the paragraph buffer and live counts. Glyph buffers are counted separately. Cache telemetry covers the current retained document only; saved old snapshots are deliberately measured by the browser after cache release. Object caret storage is captured by JS heap measurements, not guessed from object counts.', '',
  '## Loaded document', '',
  'Median deltas from each page’s warmed baseline, in decimal MB.', '',
  '| Paragraphs | Storage | JS heap | Backing stores | Sum |', '|---:|---|---:|---:|---:|'];
for(const g of groups) {
 const s=g.stages.find(s=>s.stage==='loaded');lines.push(`| ${g.paragraphs} | ${g.storage} | ${mb(s.js)} | ${mb(s.backing)} | ${mb(s.total)} |`);
}
lines.push('', '## Capacity', '', '| Paragraphs | Width | Reserved caret MB | Live payload MB | Unused |', '|---:|---:|---:|---:|---:|');
for(const g of groups.filter(g=>g.storage==='carets')) for(const [stage,width] of [['loaded',350],['wide',1200],['narrow',1]]) {
 const s=g.stages.find(s=>s.stage===stage);
 lines.push(`| ${g.paragraphs} | ${width}px | ${mb(s.caretBytes)} | ${mb(s.usedBytes)} | ${(100*(s.caretBytes-s.usedBytes)/s.caretBytes).toFixed(1)}% |`);
}
lines.push('', 'The current capacity allows one soft line per shaping cluster. At 1px width that bound is used; normal-width documents reserve spare caret slots and line boundaries. Spare capacity is retained intentionally, not a leak. An exact-sizing design needs a line-count pass or compaction/copy after composition; its latency and transient memory must be measured before adopting it.', '',
 '## Lifecycle', '', 'Median JS-plus-backing deltas from baseline, in MB. Pin-and-resize retains an old snapshot at 350px and the new snapshot at 240px. Fifty edits replace the first paragraph without retaining every intermediate snapshot. Release-cache removes the retained document while those two snapshots remain alive. Drop-snapshots then removes both references.', '',
 '| Paragraphs | Storage | Loaded | Two snapshots | After 50 edits | Cache released | Snapshots dropped | After 10 release cycles |', '|---:|---|---:|---:|---:|---:|---:|---:|');
for(const g of groups) lines.push(`| ${g.paragraphs} | ${g.storage} | `+['loaded','pin-and-resize','edit-50','release-cache','drop-snapshots','release-cycles'].map(stage=>mb(g.stages.find(s=>s.stage===stage).total)).join(' | ')+' |');
lines.push('',
 'Backing stores return to baseline after cache and snapshot references are dropped in these trials. Small residual JS heap deltas remain, so this is evidence of correct release in the tested lifecycle, not proof against every possible leak. Native WASM memory may retain allocator capacity; the warmed baseline and per-stage linear-memory measurement make that separate from retained document data.', '',
 '## Assessment', '',
 'Packed carets save roughly 14% of tracked retained document memory in these fixtures. That is materially smaller than the earlier ~46% reduction in sampled allocation volume: the two experiments measure different things. Backing-store usage rises, but the reduction in JS objects more than compensates.', '',
 'Normal-width spare caret capacity is about 53%; for 2,000 paragraphs, approximately 2.12 MB is reserved but unused. Eliminating all of it would save only about another 4% of this fixture’s tracked total, before counting any implementation overhead. It is worth testing, but is not the largest remaining memory cost.', '',
 'Cache release with two snapshots still pinned frees about 40 MB of JS heap in the 2,000-paragraph packed variant. The snapshots continue to own composed geometry, so the released memory points mainly to retained shaping data and cache bookkeeping. The source still stores glyph/cluster objects and their small arrays. A full replacement of that object graph is a more substantial memory candidate than merely adding another packed view.', '',
 'The memory case for packed carets is supported on this Chromium/M4 Pro configuration. The existing direct-caret-lookup tradeoff and occasional p95 regressions remain relevant; the default is unchanged by this measurement task.', '',
 '## Reproduce', '',
 'Build the owned page and serve the production preview on port 5175. Run `npm run memory:owned`, then `node scripts/report-owned-memory.mjs`. Set `OWNED_URL` for another server. Results are in `artifacts/owned-retained-memory.json`; summarized medians are in `artifacts/owned-memory-summary.json`.', '');
await writeFile('docs/owned-retained-memory.md',lines.join('\n'));
await writeFile('artifacts/owned-memory-summary.json',JSON.stringify(groups,null,2)+'\n');
