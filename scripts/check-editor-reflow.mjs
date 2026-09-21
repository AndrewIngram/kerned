import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { chromium, firefox, webkit } from 'playwright';

const url = process.env.EDITOR_URL ?? 'http://127.0.0.1:5176/extensions.html';

const results = [];

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    for (const total of [2000, 10000]) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      const probe = (ids = []) =>
        page.evaluate((idsValue) => window.editorDiagnostics.probe(idsValue), ids);

      const settle = () =>
        page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );

      const done = () =>
        page.waitForFunction(() => window.editorDiagnostics.probe([]).reflowPending === 0);

      await page.goto(`${url}?stream=${total}`);
      await page.waitForFunction(() => window.editorDiagnostics?.probe([]).complete);
      await done();
      const middle = Math.floor(total / 2) + 7;
      await page.evaluate((id) => window.editorDiagnostics.scrollTo(id, 8), middle);
      await settle();
      const before = await probe([middle]);
      await page.setViewportSize({ width: 420, height: 950 });
      await settle();
      const first = await probe([middle]);
      assert.ok(first.reflowPending > 0, 'Resize completed synchronously');
      assert.equal(first.stats.glyphCalls, before.stats.glyphCalls);
      const screen = (s) => s.scene[0].y * s.zoom - s.scroll;
      assert.ok(Math.abs(screen(first) - screen(before)) < 1.1, 'First viewport moved');
      await done();
      await settle();
      const after = await probe([middle]);
      assert.ok(Math.abs(screen(after) - screen(before)) < 1.1, 'Background reflow moved anchor');
      assert.equal(after.stats.glyphCalls, before.stats.glyphCalls);
      const reference = await page.evaluate(() => window.editorDiagnostics.verifyReflow());
      assert.equal(reference.blocks, total);
      // Change direction before the old generation finishes, then jump to an unreflowed region and edit it.
      await page.setViewportSize({ width: 700, height: 950 });
      await settle();
      assert.ok((await probe()).reflowPending > 0);
      await page.setViewportSize({ width: 420, height: 950 });
      await done();
      await settle();
      const reversal = await page.evaluate(() => window.editorDiagnostics.metrics().reflows.at(-1));
      assert.ok(
        reversal.batches.reduce((n, b) => n + b.layouts, 0) < total / 2,
        'Return to a cached width redid the entire document',
      );
      await page.setViewportSize({ width: 520, height: 950 });
      await settle();
      const editId = total - 9;
      await page.evaluate((id) => {
        window.editorDiagnostics.scrollTo(id);
        window.editorDiagnostics.select(id, 0);
      }, editId);
      await settle();
      const editBefore = await probe([editId]);
      assert.equal(editBefore.scene[0].layoutWidth, editBefore.width);
      assert.ok(editBefore.reflowPending > 0);
      await page.keyboard.insertText('Reflow edit ');
      await settle();
      assert.ok((await probe([editId])).nodes[0].text.startsWith('Reflow edit '));
      await page.getByLabel('Zoom').selectOption('1.25');
      await settle();
      await done();
      await settle();
      const edited = await probe([editId]);
      assert.ok(edited.nodes[0].text.startsWith('Reflow edit '));
      assert.equal(edited.stalePaints, 0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settle();
      assert.equal((await probe([editId])).nodes[0].text, editBefore.nodes[0].text);
      // DOM measurement and focused-widget pinning during a fresh width generation.
      await page.evaluate(() => window.editorDiagnostics.scrollTo(3));
      await settle();
      const block = page.locator('[data-table="3"]');
      await block.getByRole('button', { name: 'Edit cell 1, 1', exact: true }).click();
      await block.getByLabel('Cell 1, 1 text', { exact: true }).fill('Keep focus during reflow.');
      await settle();
      await page.setViewportSize({ width: 760, height: 950 });
      await settle();
      assert.ok((await probe()).reflowPending > 0);
      await block.getByLabel('Cell 1, 1 text', { exact: true }).evaluate((el) => {
        el.style.height = '410px';
      });
      await settle();
      await page.evaluate(() => window.editorDiagnostics.scrollTo(4, 8));
      await settle();
      const anchored = await probe([4]);
      await done();
      await settle();
      const final = await probe([4]);
      assert.ok(Math.abs(screen(final) - screen(anchored)) < 1.5);
      assert.equal(
        await block
          .getByLabel('Cell 1, 1 text', { exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      assert.equal(final.stalePaints, 0);
      const finalReference = await page.evaluate(() => window.editorDiagnostics.verifyReflow());
      assert.equal(finalReference.blocks, total);
      assert.deepEqual(errors, []);
      const m = await page.evaluate(() => window.editorDiagnostics.metrics());
      results.push({
        browser: name,
        total,
        reference,
        finalReference,
        runs: m.reflows.filter((r) => r.blocks === total),
        stalePaints: m.stalePaints,
      });
      await writeFile(
        'artifacts/editor-reflow-checks.json',
        JSON.stringify(results, null, 2) + '\n',
      );
      console.log(name, total, 'passed');
      await page.close();
    }

    const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}?stream=10000&paused=1`);
    await page.waitForFunction(() => window.editorDiagnostics);
    await page.evaluate(() => window.editorDiagnostics.resume());
    await page.waitForFunction(() => window.editorDiagnostics.probe([]).count > 1000);
    await page.evaluate(() => window.editorDiagnostics.pause());
    await page.waitForTimeout(50);
    await page.setViewportSize({ width: 700, height: 950 });
    await page.waitForFunction(() => window.editorDiagnostics.probe([]).reflowPending > 0);
    await page.evaluate(() => {
      window.editorDiagnostics.resume();
      window.editorDiagnostics.select(1, 0);
    });
    await page.keyboard.insertText('Concurrent ');
    await page.waitForFunction(() => {
      const p = window.editorDiagnostics.probe([]);

      return p.complete && !p.reflowPending;
    });
    const final = await page.evaluate(() => window.editorDiagnostics.probe([1]));
    assert.equal(final.count, 10000);
    assert.equal(final.stalePaints, 0);
    assert.ok(final.nodes[0].text.startsWith('Concurrent '));
    const reference = await page.evaluate(() => window.editorDiagnostics.verifyReflow());
    assert.deepEqual(errors, []);
    results.push({
      browser: name,
      total: 10000,
      streaming: true,
      reference,
      stalePaints: final.stalePaints,
    });
    await writeFile('artifacts/editor-reflow-checks.json', JSON.stringify(results, null, 2) + '\n');
    console.log(name, 'concurrent stream passed');
    await page.close();
  } finally {
    await browser.close();
  }
}
