import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { chromium, firefox, webkit } from 'playwright';

const reports = [];

for (const name of (process.env.BROWSERS ?? 'chromium').split(',')) {
  const browser = await { chromium, firefox, webkit }[name].launch();

  try {
    for (const sample of (process.env.SAMPLES ?? 'warbreaker,war-and-peace').split(','))
      for (const find of (process.env.FIND ?? 'off,on').split(',')) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }),
          errors = [];

        page.on('pageerror', (e) => errors.push(e.message));
        await page.routeWebSocket(
          (url) => url.pathname === '/',
          () => {},
        );

        if (process.env.BASELINE === '1')
          await page.route('**/src/demo/app/use-sample-stream.ts*', async (route) => {
            const response = await route.fetch(),
              body = await response.text();

            const old = body.replace(
              /batch\.done\(m\.compositionMs\s*-\s*batch\.compositionMs\)/,
              'batch.done(work)',
            );

            assert.notEqual(old, body, 'Baseline must restore the previous batch controller');
            await route.fulfill({ response, body: old });
          });
        const navigation = Date.now();
        await page.goto(
          `${process.env.BASE_URL ?? 'http://127.0.0.1:5173'}/editor.html?sample=${sample}&paused=1`,
        );
        await page.waitForFunction(() => window.editorDiagnostics);
        const firstUsableMs = Date.now() - navigation;

        if (find === 'on') {
          await page.getByRole('button', { name: 'Find', exact: true }).click();
          await page.getByRole('textbox', { name: 'Find in document', exact: true }).fill('the');
          await page.waitForFunction(
            () =>
              window.editorDiagnostics.find().query === 'the' &&
              document.querySelector('.find-count')?.getAttribute('aria-busy') === 'false',
          );
        }

        let cdp;

        if (process.env.PROFILE && name === 'chromium' && find === 'off') {
          cdp = await page.context().newCDPSession(page);
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.start');
        }

        await page.evaluate(() => {
          const baseline = window.editorDiagnostics.find().matches.length;
          window.loadBenchmark = {
            started: performance.now(),
            baseline,
            vanished: 0,
            decreased: 0,
            busyFrames: 0,
            previous: baseline,
          };

          function frame() {
            const m = window.loadBenchmark,
              count = window.editorDiagnostics.find().matches.length;

            if (m.baseline && count === 0) m.vanished++;

            if (count < m.previous) m.decreased++;

            if (document.querySelector('.find-count')?.getAttribute('aria-busy') === 'true')
              m.busyFrames++;
            m.previous = count;

            if (!window.editorDiagnostics.probe([]).complete) requestAnimationFrame(frame);
          }

          requestAnimationFrame(frame);
          window.editorDiagnostics.resume();
        });
        await page.waitForFunction(() => window.editorDiagnostics.probe([]).complete, null, {
          timeout: 120000,
        });

        if (cdp) {
          const { profile } = await cdp.send('Profiler.stop');
          await writeFile(`${process.env.PROFILE}-${sample}.cpuprofile`, JSON.stringify(profile));
        }

        if (find === 'on') {
          const expected = await page.evaluate(async () => {
            const { demoSchema } = await import('/src/extensions/demo-schema.ts');

            const count = (node) =>
              (demoSchema.text(node)?.match(/the/giu)?.length ?? 0) +
              demoSchema.children(node).reduce((total, child) => total + count(child), 0);

            return window.editorDiagnostics
              .read()
              .nodes.reduce((total, node) => total + count(node), 0);
          });

          await page.waitForFunction(
            (expectedValue) => window.editorDiagnostics.find().matches.length === expectedValue,
            expected,
          );
        }

        const report = await page.evaluate(() => {
          const m = window.editorDiagnostics.metrics(),
            b = window.loadBenchmark;

          const counts = m.samples.map((s) => s.count),
            works = m.samples.map((s) => s.workMs),
            elapsed = m.samples.map((s) => s.elapsedMs);

          const q = (list, p) =>
            [...list].toSorted((a, bValue) => a - bValue)[Math.floor((list.length - 1) * p)];

          return {
            blocks: window.editorDiagnostics.probe([]).count,
            loadMs: m.completedAt - b.started,
            batches: counts.length,
            batchSize: {
              min: Math.min(...counts),
              median: q(counts, 0.5),
              max: Math.max(...counts),
            },
            workMs: { median: q(works, 0.5), p95: q(works, 0.95) },
            elapsedMs: { median: q(elapsed, 0.5), p95: q(elapsed, 0.95) },
            layouts: m.layoutCalls,
            vanished: b.vanished,
            decreased: b.decreased,
            busyFrames: b.busyFrames,
            matches: window.editorDiagnostics.find().matches.length,
            stalePaints: m.stalePaints,
          };
        });

        reports.push({ browser: name, sample, find, firstUsableMs, ...report });
        console.log(JSON.stringify(reports.at(-1)));
        assert.deepEqual(errors, []);
        await page.close();
      }
  } finally {
    await browser.close();
  }
}

await writeFile(
  process.env.REPORT ?? 'artifacts/editor-loading.json',
  JSON.stringify(reports, null, 2) + '\n',
);

for (const row of reports) {
  assert.equal(row.vanished, 0, 'Loaded matches must stay highlighted during streaming');
  assert.equal(row.decreased, 0, 'Append-only loading must not reset the result count');
  assert.equal(row.busyFrames, 0, 'Append-only loading must not flash the search status');
  assert.equal(row.stalePaints, 0);
}
