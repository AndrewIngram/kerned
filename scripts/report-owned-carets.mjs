import { readFile, writeFile } from 'node:fs/promises';
const performance = JSON.parse(await readFile('artifacts/owned-caret-validation.json','utf8'));
const checks = JSON.parse(await readFile('artifacts/owned-caret-checks.json','utf8'));
const profiling = JSON.parse(await readFile('artifacts/owned-caret-profiling.json','utf8'));
const lines = ['# Packed caret experiment', '',
  'The opt-in `createOwnedEngine(kit, "carets")` variant replaces caret stop objects, row arrays of stop references and the offset-to-affinity map with a single paragraph-owned ArrayBuffer. It leaves glyph placement unchanged, isolating this experiment from the earlier packed-glyph path. The default is still the object implementation.', '',
  '## Representation and tradeoffs', '',
  'Float64 x positions preserve arithmetic precision. Uint32 character offsets and row starts identify stops and lines; one byte per stop stores affinity. Repeated offsets at soft wraps select the first stop for upstream affinity and the last for downstream. Offset and x lookup use binary search. Horizontal movement increments the located stop ordinal, avoiding the object path’s linear indexOf scan.', '',
  'The buffer reserves enough capacity for one line per shaping cluster: 13 bytes per reserved caret plus 4 bytes per reserved line boundary. Normal paragraphs leave spare capacity. The buffer is immutable after publication and remains paragraph-local, so placement changes and existing snapshots can share it. This is ordinary scalar JavaScript with typed arrays; it adds no runtime or serialization boundary.', '',
  'Binary search replaces average constant-time map lookup, which can slow direct caret queries. This is an explicit tradeoff rather than a claim that every operation is faster.', '',
  '## Correctness', '',
  '| Browser | Layout cases | Assertions | Pixel comparisons | Failures |', '|---|---:|---:|---:|---:|'];
for(const [name,b] of Object.entries(checks.browsers)) lines.push(`| ${name} | ${b.validation.cases} | ${b.validation.assertions} | ${b.validation.rasterCases} | ${b.validation.failures.length+b.errors.length} |`);
lines.push('', 'Coverage includes the prior size/width/document matrix, both caret affinities for all navigation directions, hit-test ties, reversed selections, empty and wrapped lines, edited-versus-cold equivalence, snapshot lifetimes, failed-layout recovery and explicit release. Query benchmarks also verify equal accumulated results for both implementations. These checks remain within the prototype’s Latin/LTR scope.', '',
  '## Layout timings', '',
  'Six warmups and 30 measured trials per workload; alternating variant order; independently primed baselines. Median / p95 in milliseconds. Drawing and startup are excluded. Zero denotes timer quantization, not free work. These are paired measurements from one local run.', '');
for(const [name,b] of Object.entries(performance.browsers)) {
  lines.push(`### ${name}`, '', '| Workload | Operation | Objects | Packed carets |','|---|---|---:|---:|');
  for(const r of b.benchmark.results) lines.push(`| ${r.fixture.name} | ${r.scenario} | `+r.variants.map(v=>`${v.medianMs.toFixed(2)} / ${v.p95Ms.toFixed(2)}`).join(' | ')+' |');
  lines.push('');
}
lines.push('## Allocations', '', 'Separate Chromium resize profiles sample every 16KiB on average and include allocations collected by minor and major GC. Both runs perform 300 full resizes of 500 paragraphs. The following figures are estimated cumulative sampled allocation volume per resize, not retained memory or RSS. ArrayBuffer backing stores and WASM memory are not completely represented; profiler elapsed times are not latency benchmarks.', '', '| Variant | Estimated allocated MB / resize |', '|---|---:|');
for(const r of profiling.runs) lines.push(`| ${r.name} | ${(r.allocations.reduce((n,a)=>n+a.sampledBytes,0)/r.iterations/1e6).toFixed(2)} |`);
lines.push('', '## Interaction timings', '', 'Median batch time in milliseconds for **5,000 queries**, with 20 measured batches and four warmups, alternating order. The long paragraph contains 700 repeats of a phrase; the document fixture has 500 paragraphs. These tests query existing layouts and exclude layout and drawing. Each object/packed pair returns the same checksum.', '', '| Browser | Fixture | Query | Objects | Packed carets |','|---|---|---|---:|---:|');
for(const [name,b] of Object.entries(checks.browsers)) for(const r of b.queries.results) lines.push(`| ${name} | ${r.kind} | ${r.operation} | `+r.variants.map(v=>v.medianBatchMs.toFixed(2)).join(' | ')+' |');
lines.push('', '## Assessment', '',
  'This is a stronger candidate than packing glyph arithmetic alone. It reduces sampled allocation volume substantially and improves several cold-layout/reflow cases. Retained edit times remain largely unchanged. Direct caret queries can be slower, while horizontal navigation in long paragraphs improves substantially. Some layout p95 values regress, so this is not a universal latency win.', '',
  'Keep the option available for further comparison. Before switching the default, check retained memory including buffer backing stores and repeat critical workloads across devices. The current overallocated capacity, rather than a serialization boundary, is an obvious next memory question. Block-level updates remain the next way to reduce document traversal during edits.', '',
  '## Reproduce', '',
  'Build and serve the owned production page on port 5175. Run `OWNED_VARIANT=carets npm run validate:owned` for paired layout timings and `npm run check:carets` for the expanded validation and query benchmarks. With the dev server on port 5173, run `OWNED_VARIANT=carets OWNED_PROFILE_SCENARIO=resize npm run profile:owned` for allocation/CPU profiles. Regenerate this report with `node scripts/report-owned-carets.mjs`.', '',
  'Artifacts: `owned-caret-validation.json`, `owned-caret-checks.json`, `owned-caret-profiling.json`; raw profiles are under `artifacts/owned-caret-profiles/`.', '');
await writeFile('docs/owned-carets.md',lines.join('\n'));
