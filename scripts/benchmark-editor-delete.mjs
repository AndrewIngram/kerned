import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { chromium, firefox, webkit } from 'playwright';

const reports = [];

for (const name of (process.env.BROWSERS ?? 'chromium').split(',')) {
  const browser = await { chromium, firefox, webkit }[name].launch();

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }),
      errors = [];

    page.setDefaultTimeout(120000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.routeWebSocket(
      (url) => url.pathname === '/',
      () => {},
    );
    await page.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker');
    await page.waitForFunction(() => window.editorDiagnostics?.probe([]).complete);

    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );

    await page.evaluate(() => {
      window.deleteBenchmark = { nodes: JSON.stringify(window.editorDiagnostics.read().nodes) };
      window.editorDiagnostics.select(1, 0);
    });
    await page.keyboard.press('ControlOrMeta+a');
    await settle();
    let cdp;

    if (process.env.PROFILE && name === 'chromium') {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }

    const deletion = await page.locator('[data-editor-input]').evaluate(async (el) => {
      const blocks = window.editorDiagnostics.read().nodes.length,
        started = performance.now();

      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
      );
      const handlerMs = performance.now() - started;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      return {
        blocks,
        handlerMs,
        paintMs: performance.now() - started,
        nodes: window.editorDiagnostics.read().nodes,
      };
    });

    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      await writeFile(process.env.PROFILE, JSON.stringify(profile));
    }

    assert.equal(deletion.nodes.length, 1, 'Deleting the book leaves one text block');
    assert.equal(deletion.nodes[0].text, '');

    const history = await page
      .getByRole('button', { name: 'Undo', exact: true })
      .evaluate(async (el) => {
        const started = performance.now();
        el.click();
        const undoHandlerMs = performance.now() - started;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        return {
          undoHandlerMs,
          undoPaintMs: performance.now() - started,
          restored:
            JSON.stringify(window.editorDiagnostics.read().nodes) === window.deleteBenchmark.nodes,
        };
      });

    assert.ok(history.restored, 'One undo restores the exact book, marks and embedded content');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await settle();
    assert.equal(await page.evaluate(() => window.editorDiagnostics.read().nodes.length), 1);
    assert.deepEqual(errors, []);

    const { nodes: _nodes, ...timings } = deletion,
      report = { browser: name, ...timings, ...history };

    reports.push(report);
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
}

await writeFile(
  process.env.REPORT ?? 'artifacts/editor-delete-performance.json',
  JSON.stringify(reports, null, 2) + '\n',
);

for (const report of reports) {
  assert.ok(report.handlerMs < 200, 'Deleting a book must not monopolize the input task');
  assert.ok(report.paintMs < 250, 'Deleting a book must reach a frame promptly');
  assert.ok(report.undoHandlerMs < 200, 'Undoing book deletion must not monopolize the input task');
  assert.ok(report.undoPaintMs < 250, 'Restoring the book must reach a frame promptly');
}
