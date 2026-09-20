import { readFile, writeFile } from 'node:fs/promises';
const result = JSON.parse(await readFile('artifacts/owned-size-validation.json', 'utf8'));
const lines = [
  '# Size validation and packed JavaScript experiment', '',
  `Recorded ${result.recordedAt} on ${result.host}.`, '',
  'Build with `npm run build:owned`, serve `dist-owned` on port 5175, then run `npm run validate:owned`. Set `OWNED_URL` to use another server. Run `node scripts/report-owned-sizes.mjs` to regenerate this report from the recorded artifact.', '',
  '## Validation coverage', '',
  '| Browser | Layout cases | Assertions | Raster comparisons | Failures |',
  '|---|---:|---:|---:|---:|',
];
for (const [name, browser] of Object.entries(result.browsers)) {
  const v = browser.validation;
  lines.push(`| ${name} ${browser.version} | ${v.cases} | ${v.assertions} | ${v.rasterCases} | ${v.failures.length + browser.errors.length} |`);
}
lines.push('',
  'Sizes: 8, 12, 20, 37.5, 72 and 128px. Widths: 1, 16, 120, 333.3, 800 and 2400px. The cross product exercises empty text, blank lines, whitespace, ligatures, combining accents, long unbroken words and styled runs. Further fixtures use 1, 100, 500 and 2,000 paragraphs, plus single paragraphs of at least 10,000 UTF-16 units. Raster comparisons cover four font sizes at DPR 1, 1.5 and 2.', '',
  'Assertions compare object and packed paths for lines, caret affinity, hit testing, all navigation directions, grapheme boundaries, selection rectangles and cold-versus-edited layout. An independent Parley comparison checks single-line widths at every font size. Raster checks compare encoded pixels exactly. The renderer tests use offscreen software surfaces scaled by DPR, not browser zoom or physical display tests. Unicode coverage remains the prototype’s Latin-only subset. The two owned variants share line-breaking and caret logic, so agreement alone is not an independent proof of typography correctness.', '',
  '## What packing changes', '',
  '`src/owned-packed.ts` prepares typed arrays of glyph font ids, output slots, advances and offsets, plus cluster ranges. During reflow, `src/owned-paragraph.ts` writes directly into preallocated Float32 position arrays and reuses glyph-id arrays. Arithmetic inputs stay Float64 so storage precision does not change wrapping or positioning.', '',
  'The experiment is scalar JavaScript. Typed arrays provide numeric storage and bulk copy operations, not an explicit portable JavaScript SIMD instruction API. SIMD.js was archived in favor of WebAssembly SIMD; this experiment introduces no new WASM or serialization boundary. See [V8’s explanation](https://v8.dev/features/simd) and [typed-array bulk copying](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/set). No generated machine-code inspection was performed, so no claim of JIT vectorization is made.', '',
  'Packing is currently a retained view alongside the shaped object graph, not a replacement for all objects. It adds storage and cold preparation. Per glyph the packed view stores one font byte, a four-byte output slot, three eight-byte numeric fields and a two-byte glyph id; cluster ranges add four bytes per cluster boundary. Glyph ids are also reused directly by the renderer. This is a payload calculation, not a measured total-memory or GC reduction.', '',
  '## Timings', '',
  'Each workload uses six warmups and 30 measured trials with alternating variant order. Each trial clears application retention. Edit and resize first prime a baseline outside timing. Cold timings include packing; edits include packing the changed paragraph. Both paths use the same shaped text, line/caret algorithms and layout API. Drawing and startup are excluded. Values are median / p95 milliseconds; p95 is nearest rank. Zero means below browser timer resolution, not free work. This is one local run without forced GC.', '',
);
for (const [name, browser] of Object.entries(result.browsers)) {
  lines.push(`### ${name}`, '', '| Workload | Operation | Objects | Packed |', '|---|---|---:|---:|');
  for (const row of browser.benchmark?.results ?? []) {
    lines.push(`| ${row.fixture.name} (${row.fixture.size}px, ${row.fixture.width}px wide) | ${row.scenario} | ` + row.variants.map(v => `${v.medianMs.toFixed(2)} / ${v.p95Ms.toFixed(2)}`).join(' | ') + ' |');
  }
  lines.push('');
}
lines.push('## Assessment', '',
  'Keep the object path as the default and retain packing as an explicit experiment. Results are mixed across workloads and browsers. Packing speeds some reflows but increases cold preparation or regresses other cases; it does not establish a universal speedup. Sub-millisecond edit comparisons are often dominated by timer resolution. Allocation/JIT/GC explanations for individual differences are hypotheses, not measured causes.', '',
  'The promising direction remains controlling data layout and avoiding work inside our JavaScript pipeline. A full packed representation should replace temporary object graphs rather than add another conversion on every update. Profile allocation and separate composition stages before promoting that larger change. Block-level updates and viewport-limited painting still offer work reduction that this numeric-loop experiment cannot provide.', '');
await writeFile('docs/owned-size-validation.md', lines.join('\n'));
