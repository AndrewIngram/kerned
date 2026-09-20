import { chromium, firefox, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

const output = {
  recordedAt: new Date().toISOString(),
  host: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model },
  browsers: {},
};
await mkdir('artifacts', { recursive: true });
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.OWNED_URL ?? 'http://127.0.0.1:5173/owned-layout.html');
    await page.waitForFunction(() => window.ownedSpike);
    const report = await page.evaluate(() => window.ownedSpike.benchmark());
    output.browsers[name] = { version: browser.version(), ...report, errors };
    // Preserve completed browsers if a later browser fails.
    await writeFile('artifacts/owned-benchmark.json', JSON.stringify(output, null, 2) + '\n');
    console.log(name);
    for (const row of report.results) {
      console.log(`${row.paragraphs} paragraphs / ${row.scenario}: ` + row.engines.map(e =>
        `${e.engine} ${e.totalMs.median.toFixed(1)} / ${e.totalMs.p95.toFixed(1)} ms`).join(' | '));
      const owned = row.engines.find(e => e.engine === 'Owned / HarfRust');
      const expectedCalls = row.scenario === 'cold-layout' ? row.paragraphs : row.scenario === 'edit' ? 1 : 0;
      const expectedCompositions = row.scenario === 'edit' ? 1 : row.paragraphs;
      if (!owned.samples.every(s => s.shapeCalls === expectedCalls && s.cacheHits === row.paragraphs - expectedCalls && s.compositions === expectedCompositions && s.renderBuffers === expectedCompositions)) {
        throw new Error(`Unexpected cache behavior: ${row.paragraphs} ${row.scenario}`);
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
  } finally {
    await browser.close();
  }
}

const report = [
  '# Repeated owned-layout benchmarks',
  '',
  `Recorded ${output.recordedAt} on ${output.host.cpu}, ${output.host.platform}/${output.host.arch}.`,
  '',
  'Run `npm run build:owned`, serve `dist-owned`, then run `OWNED_URL=http://127.0.0.1:5175/owned-layout.html npm run benchmark:owned`. The default URL uses the dev server on port 5173. Raw samples and browser versions are in `artifacts/owned-benchmark.json`.',
  '',
  'Each case uses six warmups and 30 measured trials, with all six engine orders represented equally. Each trial clears the application layout cache. Edit and resize trials prime a baseline outside the timer, then insert one character in the middle paragraph or change width from 450px to 350px. Documents have unique equal-length trial prefixes to avoid reuse across trials. Text uses 20px Noto Sans with no formatting.',
  '',
  'Cold layout means an empty application layout cache, with fonts, WASM and JIT already warm. Timings include the synchronous Engine.layout call and its current adapters. They exclude drawing, geometry queries, input handling, initialization, cache clearing, priming and disposal. These are whole-document adapter measurements; the original editor uses a separate block cache. Internal font caches are not reset.',
  '',
  'Values below are median / p95 milliseconds. P95 is the 29th sorted sample of 30. Browser timer quantization is visible, especially for short operations. No GC is forced. This is one local run, not a cross-machine performance guarantee.',
];
for (const [name, browser] of Object.entries(output.browsers)) {
  report.push('', `## ${name} ${browser.version}`, '', '| Paragraphs | Operation | CanvasKit | Parley | Owned |', '|---:|---|---:|---:|---:|');
  for (const row of browser.results) {
    report.push(`| ${row.paragraphs} | ${row.scenario} | ` + row.engines.map(e => `${e.totalMs.median.toFixed(1)} / ${e.totalMs.p95.toFixed(1)}`).join(' | ') + ' |');
  }
}
report.push('', '## Cache behavior', '',
  'Across all measured trials and browsers, editing performs one shaping call and resizing performs zero, at both 100 and 500 paragraphs. Every other paragraph is a cache hit. Cold layout shapes every paragraph. The runner checks these counts and fails if behavior differs. The immediately preceding shaping-only retention baseline is preserved in `artifacts/owned-benchmark-before-composition.json` and `docs/owned-benchmark-before-composition.md`. The earlier 256-entry cache reshaped all 500 paragraphs on edits and resizing; the baseline is preserved in `artifacts/owned-benchmark-before-retention.json` and `docs/owned-benchmark-before-retention.md`.',
  '', 'Each input id now retains only the shaped paragraph variants used by its latest successful layout. A replacement map is built while the previous map remains readable, then published after layout succeeds. Removed and superseded variants are released. Owners call `release(id)` when a document or block is removed, or `engine.clear()` to release all retained shaping. Existing LaidOut snapshots remain usable. Memory scales with retained document content; there is no byte budget or viewport eviction yet. The prototype still scans the supplied document text and rebuilds placement and flat line metadata for the comparison interface. Unchanged paragraph geometry and prepared render buffers are shared across snapshots. At unchanged width an edit composes one paragraph and builds one font run; resize composes all paragraphs but does no shaping. The runner verifies those counters on every measured trial.',
  '', '## Parley timing boundary', '',
  '| Browser | 500-paragraph cold total median | Reported core median |',
  '|---|---:|---:|');
for (const [name, browser] of Object.entries(output.browsers)) {
  const row = browser.results.find(r => r.paragraphs === 500 && r.scenario === 'cold-layout');
  const parley = row.engines.find(e => e.engine === 'Parley');
  report.push(`| ${name} | ${parley.totalMs.median.toFixed(1)} ms | ${parley.reportedCoreMs.median.toFixed(1)} ms |`);
}
report.push('',
  'The reported Parley core ends before output extraction. The remaining work includes native glyph/line traversal, UTF-16 index conversion, JSON construction/serialization, JS parsing/schema validation and typed-array conversion. It is not a measurement of JSON cost alone. The current UTF-16 conversion scans text prefixes for line endpoints, which is a source-level scaling concern; its individual cost has not been profiled.',
  '',
  'The owned engine eagerly constructs caret stops and prepared typed render buffers during layout, while the reference engines do some geometry work on demand. Feature coverage also differs: the owned prototype lacks bidi and fallback. These results compare the current adapters and cannot establish which underlying engine is intrinsically fastest.',
  '', '## Decision', '',
  'Document-owned retention removes the measured 500-paragraph shaping-cache failure. Paragraph-local composition now also removes reconstruction of unchanged paragraph geometry and render buffers. Whole-document scanning, placement metadata reconstruction and painting remain. Incremental updates within a changed paragraph and viewport scheduling are not implemented. Per-paragraph drawing changes draw-call granularity; these layout-only timings do not establish painting performance. Parley still deserves an adapter optimization before an engine decision: its total-call cost substantially exceeds its reported layout core.', '');
await writeFile('docs/owned-benchmark.md', report.join('\n'));
