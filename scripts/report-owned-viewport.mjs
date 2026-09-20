import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const raw=JSON.parse(await readFile('artifacts/owned-viewport.json','utf8'));
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const fmt=n=>n.toFixed(2);
const lines=['# Viewport drawing and adaptive loading','',`Measured ${raw.recordedAt}, ${raw.cpu}.`,'',
 'The owned snapshot now exposes `drawViewport(canvas, x, y, top, bottom)`. The interval is in document CSS-pixel coordinates before translation or canvas scaling. It binary-searches paragraph placement and submits only intersecting paragraphs, with conservative visual overflow bounds. Font bounds are cached per font/size, and shaping y-offsets are included when composing. Unknown font bounds conservatively disable culling for affected content. The caller still supplies the canvas clip. Ordinary `draw()` remains available for export and comparison. The demo UI is unchanged.','',
 'The implementation culls paragraphs, not individual lines or glyphs inside a very long paragraph. Future decorations and custom blocks that paint outside their rectangles must contribute visual bounds. The viewport query does not reshape text or create render buffers.','',
 '## Drawing','',
 '10,000 distinct styled paragraphs, 500×640 software canvas. Five warmups and 30 measured trials per position, alternating full/cull order. These include canvas clearing and flush, exclude PNG encoding, and are not GPU/browser-presentation timings. Medians in milliseconds.','',
 '| Browser | Position | Full draw | Culled draw | Paragraphs submitted | Glyph runs submitted |','|---|---|---:|---:|---:|---:|'];
for(const [browser,b] of Object.entries(raw.browsers)){
 assert.equal(b.errors.length,0);assert.ok(Object.values(b.checks).every(Boolean));assert.equal(b.retention.documents,0);
 b.drawSamples.forEach((s,i)=>lines.push(`| ${browser} | ${['top','middle','bottom'][i]} | ${fmt(median(s.all))} | ${fmt(median(s.culled))} | ${s.submitted.paragraphs} | ${s.submitted.runs} |`));
}
lines.push('','## Adaptive chunk experiment','',
 'Both paths use block-local updates and viewport drawing. Fixed batches contain 500 paragraphs. The experimental adaptive loop starts at 16, targets 8ms of work, limits batches to 1–256 paragraphs and changes the next batch by at most a factor of two. Each update yields via setTimeout(0). It is a feedback experiment in the validation harness, not a shipped network/frame scheduler or a hard time guarantee. A synchronous update and garbage collection cannot be preempted.','',
 'Three trials per policy, alternating order. Work includes parsing generated JSON block chunks, splice/layout, draw and flush; transport and initial font/WASM load are excluded. The first adaptive submission contains fewer paragraphs than the fixed submission. Elapsed time includes scheduler yields. Medians are reported except worst update and the count above 16ms, which use all updates across all three trials.','',
 '| Browser | Policy | First submission ms | Total work ms | Final submission elapsed ms | Worst update ms | Updates over 16ms / all updates |','|---|---|---:|---:|---:|---:|---:|');
for(const [browser,b] of Object.entries(raw.browsers))for(const adaptive of [false,true]){
 const runs=b.loading.filter(r=>r.adaptive===adaptive), updates=runs.flatMap(r=>r.samples);
 assert.equal(runs.length,3);
 lines.push(`| ${browser} | ${adaptive?'adaptive':'fixed 500'} | ${fmt(median(runs.map(r=>r.samples[0].elapsedMs)))} | ${fmt(median(runs.map(r=>r.samples.reduce((n,s)=>n+s.workMs,0))))} | ${fmt(median(runs.map(r=>r.samples.at(-1).elapsedMs)))} | ${fmt(Math.max(...updates.map(s=>s.workMs)))} | ${updates.filter(s=>s.workMs>16).length} / ${updates.length} |`);
}
lines.push('','## Correctness and limits','',
 'All browsers compare exact PNG bytes for full and culled drawing at DPR 1, 1.5 and 2, fractional scroll offsets, top/middle/bottom and outside-document viewports. Additional cases use stacked combining accents to verify visual overflow is preserved. Final adaptive/fixed layouts and viewport pixels match the complete document. Counters check local validation/composition, no layout work during drawing, and snapshots after release.','',
 'Smaller batches improve responsiveness and first submission at the cost of more total work and longer completion time. Each splice still rebuilds document placement/flat lines, and every batch yields. An incremental placement index is the next scaling target if that overhead dominates. The 8ms target is intentionally soft; inspect the worst-update column rather than assuming all updates meet it.','',
 '## Reproduce','',
 'Build with `npm run build:owned` and serve the owned production preview on port 5175. Run `node scripts/check-owned-viewport.mjs`, then `node scripts/report-owned-viewport.mjs`. `OWNED_URL` can select another server. Raw samples: `artifacts/owned-viewport.json`.','');
await writeFile('docs/owned-viewport.md',lines.join('\n'));
console.log('Verified viewport results for',Object.keys(raw.browsers).join(', '));
