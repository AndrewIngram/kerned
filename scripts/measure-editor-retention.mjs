import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

import { chromium } from 'playwright';

const base = process.env.EDITOR_URL ?? 'http://127.0.0.1:5176/extensions.html';

const report = {
  recordedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  editorURL: base,
  mode: process.env.BENCHMARK_MODE ?? 'production',
  cases: [],
};

const browser = await chromium.launch();

try {
  for (const total of [2000, 10000])
    for (const retention of ['all', 'viewport']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 950 } }),
        errors = [];

      page.on('pageerror', (e) => errors.push(e.message));

      const settle = () =>
        page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );

      await page.goto(`${base}?stream=${total}&paused=1&retention=${retention}`);
      await page.waitForFunction(() => window.editorDiagnostics);
      await settle();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.enable');

      async function heap() {
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.collectGarbage');

        return cdp.send('Runtime.getHeapUsage');
      }

      const baseline = await heap();
      await page.evaluate(() => window.editorDiagnostics.resume());
      await page.waitForFunction(() => window.editorDiagnostics.probe([]).complete);
      await settle();

      const loaded = await heap(),
        initial = await page.evaluate(() => window.editorDiagnostics.metrics());

      const initialGlyphCalls = await page.evaluate(
        () => window.editorDiagnostics.probe([]).stats.glyphCalls,
      );

      const scrolls = [];

      for (let cycle = 0; cycle < 3; cycle++)
        for (const id of [Math.floor(total / 2) + 6, total + 5, 1]) {
          await page.evaluate((idValue) => window.editorDiagnostics.scrollTo(idValue), id);
          await settle();

          const m = await page.evaluate(() => window.editorDiagnostics.metrics()),
            p = await page.evaluate(() => window.editorDiagnostics.probe([]));

          assert.equal(p.stats.glyphCalls, initialGlyphCalls);
          assert.equal(m.memory.caretUnusedBytes, 0);
          assert.equal(m.stalePaints, 0);

          if (retention === 'viewport') assert.ok(m.residentParagraphs < 128);

          const reference =
            cycle === 0
              ? await page.evaluate(() => window.editorDiagnostics.verifyReflow())
              : undefined;

          scrolls.push({
            cycle,
            id,
            reference,
            sceneMs: m.lastSceneMs,
            resident: m.residentParagraphs,
            glyphCalls: p.stats.glyphCalls,
            layoutCalls: m.layoutCalls,
          });
        }

      assert.equal(new Set(scrolls.map((s) => s.glyphCalls)).size, 1);
      const reference = await page.evaluate(() => window.editorDiagnostics.verifyReflow());
      await page.setViewportSize({ width: 700, height: 950 });
      await settle();
      await page.waitForFunction(() => window.editorDiagnostics.probe([]).reflowPending === 0);
      await settle();
      const resizedReference = await page.evaluate(() => window.editorDiagnostics.verifyReflow());
      await page.setViewportSize({ width: 1100, height: 950 });
      await settle();
      await page.waitForFunction(() => window.editorDiagnostics.probe([]).reflowPending === 0);
      await settle();

      const afterCycles = await heap(),
        final = await page.evaluate(() => window.editorDiagnostics.metrics());

      assert.equal(final.stalePaints, 0);
      assert.deepEqual(errors, []);

      if (retention === 'viewport') assert.ok(final.memory.composedParagraphs < 128);
      report.cases.push({
        total,
        retention,
        baseline,
        loaded,
        afterCycles,
        delta: {
          usedSize: loaded.usedSize - baseline.usedSize,
          backingStorageSize: loaded.backingStorageSize - baseline.backingStorageSize,
        },
        initialMemory: initial.memory,
        finalMemory: final.memory,
        scrolls,
        reference,
        resizedReference,
      });
      await writeFile(
        process.env.RETENTION_REPORT ?? 'artifacts/editor-retention.json',
        JSON.stringify(report, null, 2) + '\n',
      );
      console.log(total, retention, report.cases.at(-1).delta, final.memory.composedParagraphs);
      await page.close();
    }
} finally {
  await browser.close();
}
