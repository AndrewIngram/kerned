import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const memory = JSON.parse(await readFile('artifacts/owned-shaping-memory.json', 'utf8'));
const validation = JSON.parse(await readFile('artifacts/owned-shaping-validation.json', 'utf8'));
const median = xs => [...xs].sort((a,b) => a-b)[Math.floor(xs.length/2)];
const mb = x => (x/1e6).toFixed(2);
assert.equal(memory.trials.length,12);
for (const trial of memory.trials) {
 const baseline=trial.stages[0];
 for (const row of trial.stages) {
  assert.equal(row.state.memory.wasmLinearBytes,baseline.state.memory.wasmLinearBytes);
  assert.equal(row.state.memory.caretBufferBytes,row.state.memory.caretUsedBytes+row.state.memory.caretUnusedBytes);
  if(['release-cache','drop-snapshots','release-cycles'].includes(row.stage)) assert.equal(row.state.retention.documents,0);
  if(['drop-snapshots','release-cycles'].includes(row.stage)) {
   assert.equal(row.state.snapshots,0);
   assert.equal(row.heap.backingStorageSize,baseline.heap.backingStorageSize);
  }
 }
}
const groups=[];
for(const paragraphs of [500,2000]) for(const storage of ['carets','shaping']) {
 const trials=memory.trials.filter(t=>t.paragraphs===paragraphs&&t.storage===storage);
 assert.equal(trials.length,3);
 const stages=trials[0].stages.map(({stage})=>{
  const rows=trials.map(t=>t.stages.find(s=>s.stage===stage));
  const js=trials.map((t,i)=>rows[i].heap.usedSize-t.stages[0].heap.usedSize);
  const backing=trials.map((t,i)=>rows[i].heap.backingStorageSize-t.stages[0].heap.backingStorageSize);
  return {stage,js:median(js),backing:median(backing),total:median(js.map((v,i)=>v+backing[i])),shapingBytes:median(rows.map(r=>r.state.memory.shapingBufferBytes))};
 });
 groups.push({paragraphs,storage,stages});
}
const lines=['# Packed shaping experiment','',
 `Recorded ${memory.recordedAt}, ${memory.cpu}. Memory measured in Chromium ${memory.version}.`,'',
 '## Implementation','',
 'The opt-in `shaping` variant replaces retained glyph objects, cluster objects, per-cluster arrays and the break Set with numeric columns. Cluster widths use Float64; offsets and range boundaries use Uint32; break flags use Uint8. Glyph data uses the existing packed placement representation. Composition reads those columns directly, with packed carets enabled. The default remains unchanged.','',
 'The shaping path decodes the existing native binary result directly into owned numeric columns. A count pass sizes glyph and cluster storage; a fill pass scales metrics and builds cluster ranges. Unstyled text reads the native view synchronously. Styled text copies each numeric run before the next native call overwrites the result. No per-glyph or per-cluster objects are built on this path. Grapheme segmentation and per-style-run descriptors still allocate. There is no new worker, WASM call, serialization format or SIMD instruction. Packed glyph IDs are shared with composed render runs; old snapshots retain those IDs safely across edits and cache release. Snapshot construction has its own function scope so returned closures cannot retain composition-only shaping data. The memory runner checks that releasing the cache frees the shaping data even while old snapshots remain alive.','',
 '## Retained memory','',
 'Three fresh pages per variant and size, alternating order. Each page warms the same document and releases it before recording a baseline. Each stage unwinds the evaluation stack and forces GC twice. Values below are median deltas from that baseline, in decimal MB. Backing stores include ArrayBuffers and external strings. JS plus backing is a tracked-memory comparison, not total browser memory or RSS. It excludes parts of native and GPU allocation.','',
 '| Paragraphs | Storage | JS heap | Backing stores | Sum |','|---:|---|---:|---:|---:|'];
for(const g of groups){const s=g.stages.find(s=>s.stage==='loaded'); lines.push(`| ${g.paragraphs} | ${g.storage} | ${mb(s.js)} | ${mb(s.backing)} | ${mb(s.total)} |`);}
lines.push('','Both arms use packed carets. The difference measures replacement of retained shaping objects plus use of packed glyph placement. It does not isolate cluster packing from glyph placement. Exact `shapingBufferBytes` includes glyph ID buffers also referenced by composed runs, so it must not be added to `glyphBufferBytes` without deduplicating shared buffers.','',
 '## Lifecycle','',
 '| Paragraphs | Storage | Loaded | Two snapshots | After 50 edits | Cache released | Snapshots dropped | After 10 release cycles |','|---:|---|---:|---:|---:|---:|---:|---:|');
for(const g of groups) lines.push(`| ${g.paragraphs} | ${g.storage} | `+['loaded','pin-and-resize','edit-50','release-cache','drop-snapshots','release-cycles'].map(stage=>mb(g.stages.find(s=>s.stage===stage).total)).join(' | ')+' |');
lines.push('','All trials return backing stores to the warmed baseline after cache and snapshots are released. Small residual JS deltas remain. The native shaping module keeps the same linear-memory size at every stage in each trial. These checks cover this lifecycle, not every possible leak.','',
 '## Correctness and timing','',
 'Validation compares the new variant with the original object implementation, including independent Parley width checks. Timing compares packed carets against packed shaping, with six warmups and 30 measured trials per scenario, alternating order. Cold and edit timings include direct decoding and buffer construction. Timed fixtures are unstyled; styled text is covered by correctness checks. No drawing or startup is timed. Zero medians in Firefox/WebKit reflect timer resolution.','',
 '| Browser | Cases | Assertions | Pixel comparisons | Failures |','|---|---:|---:|---:|---:|');
for(const [name,b] of Object.entries(validation.browsers)) {
 assert.equal(b.validation.failures.length,0); assert.equal(b.errors.length,0);
 assert.ok(b.benchmark.results.every(r=>r.countsPassed));
 lines.push(`| ${name} | ${b.validation.cases} | ${b.validation.assertions} | ${b.validation.rasterCases} | 0 |`);
}
lines.push('','Font sizes 8, 12, 20, 37.5, 72 and 128; widths 1, 16, 120, 333.3, 800 and 2400. Documents include empty and blank paragraphs, whitespace, ligatures, combining accents, long words, styled text, up to 2,000 paragraphs and a long single paragraph. Pixel checks use offscreen DPR 1, 1.5 and 2. Lifetime checks cover edits, reordering, release, failed layout and old snapshots. The existing Latin/LTR limitation remains.','',
 '| Browser | Fixture | Operation | Packed carets median / p95 ms | Packed shaping median / p95 ms |','|---|---|---|---:|---:|');
for(const [name,b] of Object.entries(validation.browsers)) for(const r of b.benchmark.results) lines.push(`| ${name} | ${r.fixture.name} | ${r.scenario} | `+r.variants.map(v=>`${v.medianMs.toFixed(2)} / ${v.p95Ms.toFixed(2)}`).join(' | ')+' |');
lines.push('','## Assessment','',
 'Direct decoding removes the earlier cold-layout penalty in the measured fixtures. The 500-paragraph cold medians improve against the paired packed-caret baseline in Chromium, Firefox and WebKit; smaller operations sometimes tie at timer resolution. Resize and long-paragraph edit medians also improve or tie. Retained memory remains much lower than object-backed shaping. Occasional p95 regressions still occur, so these results do not promise every operation is faster. The default remains unchanged. The next validation target is initial loading and viewport work on much larger documents, with styled workloads included. The prior conversion implementation results are archived in [the conversion report](owned-shaping-conversion.md); separate-run timings should not be treated as a controlled head-to-head comparison.','',
 '## Reproduce','',
 'Run `npm run build:owned` and serve the owned production preview on port 5175. Run `OWNED_VARIANT=shaping node scripts/validate-owned-sizes.mjs`, then `OWNED_VARIANT=shaping node scripts/measure-owned-memory.mjs`, then `node scripts/report-owned-shaping.mjs`. Use `OWNED_URL` for another server. Run benchmarks without competing workloads. Raw artifacts are `artifacts/owned-shaping-validation.json` and `artifacts/owned-shaping-memory.json`.','');
await writeFile('artifacts/owned-shaping-summary.json',JSON.stringify(groups,null,2)+'\n');
await writeFile('docs/owned-packed-shaping.md',lines.join('\n'));
console.log(JSON.stringify(groups.map(g=>({paragraphs:g.paragraphs,storage:g.storage,loaded:g.stages.find(s=>s.stage==='loaded')})),null,2));
