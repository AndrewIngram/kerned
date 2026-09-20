import { readFile, writeFile } from 'node:fs/promises';
const data = JSON.parse(await readFile('artifacts/owned-profiling.json', 'utf8'));
const lines = [
  '# Composition CPU and allocation profiling', '',
  `Recorded ${data.recordedAt} on ${data.cpu}, Chromium ${data.version}.`, '',
  '## Method', '',
  'Run the Vite dev server on port 5173, then `npm run profile:owned`. Readable generated source is captured alongside each profile so line attribution can be audited. Workloads use 500 distinct paragraphs, 12px text, and alternating widths of 240px and 175.2px. Cold layout runs 100 iterations, resize 300, and one-paragraph edits 2,000. Setup and warmup occur before capture. The edit harness constructs input text inside the captured interval; it is identified separately.', '',
  'CPU sampling requests a 100µs interval. Actual sampling cadence is browser-dependent. Allocation sampling uses a 16KiB average interval and includes objects collected by both minor and major GC. CPU and allocation captures are separate. These runs include profiler overhead and are not latency benchmarks. Allocation estimates describe cumulative sampled allocation volume, not retained memory, RSS, or a complete account of ArrayBuffer backing stores and WASM memory.', '',
  'Raw `.cpuprofile`, `.heapprofile` and generated-source files are under `artifacts/owned-profiles/`; the compact result is `artifacts/owned-profiling.json`.', '',
  '## CPU samples by stage', '',
  'Paragraph stages below use source-line tick attribution, not inserted timers. Generated code/inlining can blur attribution, and source ticks are diagnostic rather than precise stage durations. Percentages use all self CPU samples, including runtime and harness work. Unlisted samples include shaping, grapheme segmentation, document traversal, placement, packing preparation and runtime work.', '',
  '| Workload | Wrap | Glyph positioning | Caret creation | Caret index | Render buffers | GC |',
  '|---|---:|---:|---:|---:|---:|---:|',
];
const summaries = [];
for (const run of data.runs) {
  const sources = JSON.parse(await readFile(`artifacts/owned-profiles/${run.name}.sources.json`, 'utf8'));
  const source = Object.values(sources).find(s => s.url.endsWith('/src/owned-paragraph.ts')).scriptSource.split('\n');
  const at = text => { const n = source.findIndex(l => l.includes(text)); if (n < 0) throw new Error(`Missing stage marker ${text}`); return n + 1; };
  const boundaries = {
    wrap: at('let end = first'), row: at('const row = []'), glyph: at('let x = 0'),
    caret: at('cluster.stops.forEach'), advance: at('x += cluster.width'),
    buffers: at('const runs ='), index: at('const byOffset ='), locate: at('function locate'),
    packedBuffers: at('const packedPositions ='),
  };
  const stages = { wrap: 0, glyph: 0, caret: 0, index: 0, buffers: 0 };
  const total = run.functions.reduce((n,f)=>n+f.samples,0);
  for (const fn of run.functions.filter(f=>f.url.endsWith('/src/owned-paragraph.ts'))) {
    for (const {line,ticks} of fn.positionTicks ?? []) {
      if (line === boundaries.packedBuffers || line >= boundaries.buffers && line < boundaries.index) stages.buffers += ticks;
      else if (line >= boundaries.index && line < boundaries.locate) stages.index += ticks;
      else if (line >= boundaries.wrap && line < boundaries.row) stages.wrap += ticks;
      else if (line >= boundaries.row && line < boundaries.glyph || line >= boundaries.caret && line < boundaries.advance) stages.caret += ticks;
      else if (line >= boundaries.glyph && line < boundaries.caret) stages.glyph += ticks;
    }
  }
  const gc = run.functions.filter(f=>f.functionName==='(garbage collector)').reduce((n,f)=>n+f.samples,0);
  lines.push(`| ${run.name} | `+[stages.wrap, stages.glyph, stages.caret, stages.index, stages.buffers, gc].map(n=>`${(100*n/total).toFixed(1)}%`).join(' | ')+' |');
  const allocated = run.allocations.reduce((n,a)=>n+a.sampledBytes,0)/run.iterations;
  summaries.push({name:run.name, totalSamples:total, stages,gc, estimatedAllocatedBytesPerOperation:allocated});
}
lines.push('', '## Allocation estimates', '', '| Workload | Estimated allocated MB per operation |', '|---|---:|');
for (const r of summaries) lines.push(`| ${r.name} | ${(r.estimatedAllocatedBytesPerOperation/1e6).toFixed(2)} |`);
lines.push('',
  'During resize, the largest attributed allocation sites are `composeParagraph` and `Map.set`. Sampling/inlining prevents attributing every byte to an individual object constructor. The source creates one stop object for each caret position and another pair object for each unique offset in the caret map. Packing glyph input does not remove either structure.', '',
  'Cold layout also spends substantial samples in `boundaries`/grapheme segmentation and HarfRust. Packing itself becomes additional work there. During retained edits, very little time remains in paragraph composition: document traversal, cache keys and rebuilding placement/flat line metadata dominate the owned JavaScript work.', '',
  '## Assessment', '',
  'The next numeric-data experiment should target caret storage and indexing rather than further specializing glyph arithmetic. Ordered offset/x arrays plus per-line ranges could replace stop objects and offset-pair maps. This remains a hypothesis to test: binary-search lookup, soft-wrap affinities, snapshot lifetimes and memory must be checked against the current implementation.', '',
  'Keep the current default until a packed-caret prototype demonstrates consistent benefits. For edits, block-level input and incremental document placement are more promising than a faster glyph loop. None of these steps requires a new serialization or WebAssembly boundary.', '');
const repeat = JSON.parse(await readFile('artifacts/owned-storage-repeat.json', 'utf8'));
lines.push('## Unprofiled repeat', '',
  'A separate production-build run in fresh browser sessions repeats six warmups and 30 measured trials per case. CPU/allocation profilers are not attached. Raw results are in `artifacts/owned-storage-repeat.json`. The full result includes cold, edit and resize workloads; selected 500-paragraph resize medians/p95 follow.', '',
  '| Browser | Font size | Objects median / p95 | Packed median / p95 |',
  '|---|---:|---:|---:|');
for (const [browser, entry] of Object.entries(repeat.browsers)) {
  for (const row of entry.benchmark.results.filter(r => r.fixture.count === 500 && r.scenario === 'resize')) {
    lines.push(`| ${browser} | ${row.fixture.size}px | ` + row.variants.map(v => `${v.medianMs.toFixed(2)} / ${v.p95Ms.toFixed(2)} ms`).join(' | ') + ' |');
  }
}
lines.push('', 'The repeat favors packed placement for these 500-paragraph resize cases, but the earlier Chromium small-text case had the opposite ranking. Cold setup is often slower and retained edits are largely unchanged. One configuration/run must not decide the default. Timers quantize short operations, especially in Firefox and WebKit.', '');
await writeFile('docs/owned-profiling.md', lines.join('\n'));
await writeFile('artifacts/owned-profile-summary.json', JSON.stringify(summaries,null,2)+'\n');
