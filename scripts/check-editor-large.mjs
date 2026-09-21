import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';

import { chromium, firefox, webkit } from 'playwright';

const base = process.env.EDITOR_URL ?? 'http://127.0.0.1:5176/extensions.html';

const report = { recordedAt: new Date().toISOString(), cpu: os.cpus()[0]?.model, cases: [] };

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    for (const [total, width, dpr] of [
      [2000, 1100, 1],
      [10000, 1100, 1],
      [10000, 420, 1.5],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height: 950 },
        deviceScaleFactor: dpr,
      });

      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      const probe = (ids = []) =>
        page.evaluate((idsValue) => window.editorDiagnostics.probe(idsValue), ids);

      const settle = () =>
        page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );

      await page.goto(`${base}?stream=${total}&paused=1&slowImages=1`);
      await page.waitForFunction(() => window.editorDiagnostics);
      await settle();
      assert.equal((await probe()).count, 32);
      const initial = await page.evaluate(() => window.editorDiagnostics.metrics());
      assert.equal(initial.firstLoaded, 32);
      const input = page.getByLabel('Editor text input');
      await page.evaluate(() => window.editorDiagnostics.select(1, 0));
      await settle();
      await page.keyboard.insertText('Edited ');
      await settle();
      let first = await probe([1, 2, 3, 4]);
      let snapshot = first.scene;
      // Append in the background with an active editor selection.
      await page.evaluate(() => window.editorDiagnostics.resume());
      await page.waitForFunction(() => window.editorDiagnostics.probe([]).count >= 64);
      assert.ok((await probe()).count < total);
      await page.keyboard.insertText('Live ');
      await settle();
      first = await probe([1, 2, 3, 4]);
      snapshot = first.scene;
      assert.ok(first.count < total);
      assert.ok(first.nodes[0].text.startsWith('Edited Live '));
      await page.waitForFunction(() => window.editorDiagnostics.probe([]).count >= 256);
      await page.evaluate(() => window.editorDiagnostics.pause());
      await settle();
      const arrived = await probe([1, 2, 3, 4]);
      assert.ok(arrived.count > 32 && arrived.count < total);
      assert.deepEqual(arrived.scene, snapshot);
      assert.deepEqual(arrived.selection, first.selection);
      assert.equal(await input.evaluate((el) => document.activeElement === el), true);
      assert.ok(
        arrived.lastLayoutIds.every((id) => id >= 38),
        'Append recomposed an existing paragraph',
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settle();
      const undone = await probe([1]);
      assert.equal(undone.count, arrived.count);
      assert.ok(!undone.nodes[0].text.startsWith('Edited Live '));
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settle();
      assert.equal((await probe()).count, arrived.count);
      assert.ok(!(await probe([1])).nodes[0].text.startsWith('Edited '));
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await settle();
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await settle();
      assert.ok((await probe([1])).nodes[0].text.startsWith('Edited '));
      // A real image decode changes a placeholder's height while its top is above the viewport.
      await page.evaluate(() => window.editorDiagnostics.scrollTo(14, 40));
      await settle();
      const beforeImage = await probe([14, 15]);
      const imageGlyphCalls = beforeImage.stats.glyphCalls;
      await page.locator('[data-image="14"] img').waitFor();
      await page.waitForFunction(() => window.editorDiagnostics.probe([14]).scene[0].height > 100);
      await settle();
      const afterImage = await probe([14, 15]);
      assert.equal(
        afterImage.scene[1].y,
        afterImage.scene[0].y + Math.ceil(afterImage.scene[0].height / 4) * 4 + 24,
      );
      assert.ok(Math.abs(afterImage.scroll - beforeImage.scroll) < 1.1);
      assert.equal(afterImage.stats.glyphCalls, imageGlyphCalls);
      // Resize a retained, focused widget above the viewport and preserve the next block's screen position.
      await page.evaluate(() => window.editorDiagnostics.scrollTo(3));
      await settle();
      const block = page.locator('[data-table="3"]');
      await block.getByRole('button', { name: 'Edit cell 1, 1', exact: true }).click();
      await block
        .getByLabel('Cell 1, 1 text', { exact: true })
        .fill('Keep this note while loading.');
      await settle();
      await block.getByLabel('Cell 1, 1 text', { exact: true }).focus();
      await settle();
      await page.evaluate(() => window.editorDiagnostics.scrollTo(4, 8));
      await settle();
      const anchorBefore = await probe([4]);
      await block.getByLabel('Cell 1, 1 text', { exact: true }).evaluate((el) => {
        el.style.height = '410px';
      });
      await page.waitForFunction(() => window.editorDiagnostics.probe([3]).scene[0].height > 400);
      await settle();
      const anchorAfter = await probe([4]);
      assert.ok(
        Math.abs(
          anchorAfter.scene[0].y -
            anchorAfter.scroll -
            (anchorBefore.scene[0].y - anchorBefore.scroll),
        ) < 1.1,
        'Widget resize moved anchor',
      );
      assert.equal(
        await block
          .getByLabel('Cell 1, 1 text', { exact: true })
          .evaluate((el) => document.activeElement === el),
        true,
      );
      const atResume = await probe();
      await page.evaluate(() => window.editorDiagnostics.resume());
      await page.waitForFunction(() => window.editorDiagnostics.probe([]).complete, undefined, {
        timeout: 120000,
      });
      await settle();
      const discussions = await page.evaluate(() => window.editorDiagnostics.comments());
      assert.equal(discussions.threads.length, 1 + Math.floor((total - 4 + 10) / 20));
      assert.equal(discussions.unresolved.length, 0);
      assert.equal(discussions.resolved.length, discussions.threads.length);
      const loaded = await probe([1, 3]);
      assert.equal(loaded.count, total);
      assert.ok(loaded.nodes[0].text.startsWith('Edited '));
      assert.equal(loaded.nodes[1].rows[0][0].paragraphs[0].text, 'Keep this note while loading.');
      assert.deepEqual(loaded.selection, atResume.selection);
      await page.getByRole('button', { name: 'Undo', exact: true }).focus();
      await settle();
      const beforeScroll = await probe();

      for (const id of [Math.floor(total / 2) + 6, total + 5, 1]) {
        await page.evaluate((idValue) => window.editorDiagnostics.scrollTo(idValue), id);
        await settle();
        const state = await probe();
        assert.ok(state.mounted.length < 10);
        assert.equal(state.stats.glyphCalls, beforeScroll.stats.glyphCalls);
        assert.ok(state.layoutCalls - beforeScroll.layoutCalls < 100);
        assert.equal(state.stalePaints, 0);
      }

      // Edits to a styled paragraph should touch just that paragraph.
      await page.evaluate(() => window.editorDiagnostics.scrollTo(11));
      await settle();
      await page.evaluate(() => window.editorDiagnostics.select(11, 0));
      await settle();
      const styledBefore = await probe([11]);
      await page.keyboard.insertText('New ');
      await settle();
      const styledAfter = await probe([11]);
      assert.deepEqual(styledAfter.lastLayoutIds, [11]);
      assert.equal(styledAfter.nodes[0].marks[0].from, styledBefore.nodes[0].marks[0].from + 4);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settle();
      assert.deepEqual((await probe([11])).nodes, styledBefore.nodes);
      await page.evaluate(
        (end) => window.editorDiagnostics.select(11, end),
        styledBefore.nodes[0].marks[0].to,
      );
      await settle();
      await page.keyboard.insertText('\u0301');
      await settle();
      assert.equal((await probe([11])).nodes[0].marks[0].to, styledBefore.nodes[0].marks[0].to + 1);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settle();
      const resizeId = Math.floor(total / 2) + 6;
      await page.evaluate((id) => window.editorDiagnostics.scrollTo(id, 8), resizeId);
      await settle();
      const resizeBefore = await probe([resizeId]);
      await page.setViewportSize({ width: width === 420 ? 520 : 700, height: 950 });
      await settle();
      await settle();
      const resized = await probe([resizeId]);
      assert.equal(resized.stats.glyphCalls, resizeBefore.stats.glyphCalls);
      assert.ok(resized.layoutCalls > resizeBefore.layoutCalls);
      assert.equal(resized.count, total);
      assert.ok(
        Math.abs(
          resized.scene[0].y - resized.scroll - (resizeBefore.scene[0].y - resizeBefore.scroll),
        ) < 1.1,
        'Width reflow moved anchor',
      );
      const metrics = await page.evaluate(() => window.editorDiagnostics.metrics());
      assert.ok(metrics.maxMounted < 10);
      assert.ok(metrics.maxSubmitted < 25);
      assert.deepEqual(errors, []);
      report.cases.push({
        browser: name,
        version: browser.version(),
        total,
        width,
        dpr,
        checks: 'passed',
        firstCanvasFlushMs: metrics.firstCanvasFlushMs,
        firstLoaded: metrics.firstLoaded,
        maxMounted: metrics.maxMounted,
        maxSubmitted: metrics.maxSubmitted,
        layoutCalls: metrics.layoutCalls,
        cachedParagraphs: metrics.cachedParagraphs,
        memory: metrics.memory,
        widthChanges: metrics.widthChanges,
        editPaintMs: metrics.editPaintMs,
      });
      await writeFile('artifacts/editor-large-checks.json', JSON.stringify(report, null, 2) + '\n');
      console.log(name, total, width, 'passed');
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
