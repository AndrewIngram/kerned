import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { chromium, firefox, webkit } from 'playwright';

const url = process.env.EDITOR_URL ?? 'http://127.0.0.1:5176/extensions.html';

const results = [];

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    for (const [width, dpr] of [
      [1100, 1],
      [420, 1.5],
      [760, 2],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height: 950 },
        deviceScaleFactor: dpr,
      });

      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(url);
      await page.waitForFunction(() => window.editorDiagnostics);
      const read = () => page.evaluate(() => window.editorDiagnostics.read());

      const settle = () =>
        page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );

      await settle();
      const atom = (await read()).nodes[0].inline[0];
      const input = page.getByLabel('Canvas text input');
      await page.getByLabel('Open @Maya Chen').click();
      await page.getByRole('dialog').waitFor();
      assert.match(await page.getByRole('dialog').innerText(), /Design team/);
      await page.keyboard.press('Escape');
      assert.equal(await input.evaluate((el) => el === document.activeElement), true);
      await page.evaluate((i) => window.editorDiagnostics.select(1, i), atom.index);
      await page.keyboard.press('ArrowRight');
      assert.equal((await read()).selection.focus, atom.index + 1);
      await page.keyboard.press('Shift+ArrowLeft');
      await settle();

      if ((await read()).selection.focus === atom.index + 1) {
        await page.keyboard.press('Shift+ArrowLeft');
        await settle();
      }

      const copied = await input.evaluate((el) => {
        const clipboardData = new DataTransfer();

        const event = new ClipboardEvent('copy', {
          bubbles: true,
          cancelable: true,
          clipboardData,
        });

        el.dispatchEvent(event);

        return event.clipboardData.getData('text/plain');
      });

      assert.equal(copied, '@Maya Chen', `${name}/${width} copy`);
      await page.keyboard.press('Backspace');
      assert.equal((await read()).nodes[0].inline.length, 0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.equal((await read()).nodes[0].inline.length, 1);
      await page.evaluate(() => window.editorDiagnostics.select(1, 0));
      await settle();
      await page.keyboard.type('Hello ');
      assert.equal((await read()).nodes[0].inline[0].index, atom.index + 6);

      for (let i = 0; i < 6; i++)
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.equal((await read()).nodes[0].inline[0].index, atom.index);

      for (const zoom of ['1', '1.25', '1.5']) {
        await page.getByLabel('Zoom').selectOption(zoom);
        await settle();

        const delta = await page.evaluate(() => {
          const s = window.editorDiagnostics.read(),
            p = s.scene[0],
            b = p.boxes[0],
            r = document.querySelector('[data-mention]').getBoundingClientRect(),
            v = document.querySelector('.document-scroll').getBoundingClientRect();

          return [
            r.left - v.left - (28 + b.x) * s.zoom,
            r.top - v.top - (p.y + b.y) * s.zoom + s.scroll,
            r.width - b.width * s.zoom,
          ];
        });

        assert.ok(
          delta.every((v) => Math.abs(v) < 1.1),
          `geometry ${name}/${width}/${zoom}: ${delta.join(',')}`,
        );
      }

      await page.getByLabel('Zoom').selectOption('1');
      await settle();
      await page.getByLabel('Open comment on highlighted text').first().click();
      const initialGlyphCalls = (await read()).stats.glyphCalls;
      await page.getByLabel('Reply').fill('Keep this focused.');
      assert.equal((await read()).stats.glyphCalls, initialGlyphCalls);
      await page.keyboard.press('Escape');
      const block = page.locator('[data-widget="3"]');
      await block.getByRole('button').click();
      await page.waitForFunction(
        () => window.editorDiagnostics.read().scene.find((p) => p.id === 3).height > 250,
      );
      await block.getByLabel('Block notes').fill('Persist through virtualization.');
      await block.getByLabel('Review the examples').check();
      await settle();
      const state = await read();
      assert.equal(state.stats.glyphCalls, initialGlyphCalls);

      const place = state.scene.find((p) => p.id === 3),
        next = state.scene.find((p) => p.id === 4);

      assert.equal(
        next.y,
        place.y + Math.ceil(place.height / 4) * 4 + 24,
        'Checklist spacing includes 4px grid alignment',
      );
      // A focused DOM widget stays mounted outside the visible range.
      await block.getByLabel('Block notes').focus();
      await settle();
      await page.locator('.document-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
      await settle();
      assert.ok((await read()).mounted.includes('3'));
      await page.getByRole('button', { name: 'Undo', exact: true }).focus();
      await settle();
      assert.ok(!(await read()).mounted.includes('3'));
      const bottom = await read();
      assert.ok(bottom.mounted.length < 8);
      assert.equal(bottom.stats.glyphCalls, initialGlyphCalls);
      await page.locator('.document-scroll').evaluate((el) => (el.scrollTop = 0));
      await block.waitFor();
      await settle();
      assert.equal(
        await block.getByLabel('Block notes').inputValue(),
        'Persist through virtualization.',
      );
      assert.equal(await block.getByLabel('Review the examples').isChecked(), true);
      await page.evaluate(() => window.editorDiagnostics.select(1, 0));
      await settle();
      await input.evaluate((el) => {
        const clipboardData = new DataTransfer();

        const event = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData,
        });

        event.clipboardData.setData('text/plain', 'Pasted\ntext ');
        el.dispatchEvent(event);
      });
      assert.equal((await read()).nodes[0].text, 'Pasted');
      assert.ok((await read()).nodes[1].text.startsWith('text '));
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.evaluate(() => window.editorDiagnostics.select(1, 0));
      await settle();
      await page.keyboard.insertText('漢');
      await page.getByRole('status').filter({ hasText: 'Latin' }).waitFor();
      assert.ok(!(await read()).nodes[0].text.includes('漢'));
      await page.evaluate((i) => window.editorDiagnostics.select(1, i + 1), atom.index);
      await settle();
      await page.keyboard.insertText('\u0301');
      await page.getByRole('status').filter({ hasText: 'Combining marks' }).waitFor();
      assert.equal((await read()).nodes[0].inline.length, 1);
      const inline = await page.evaluate(() => window.editorDiagnostics.checkInline());
      assert.ok(inline.assertions > 100);
      assert.deepEqual(errors, []);
      results.push({
        browser: name,
        width,
        dpr,
        inlineAssertions: inline.assertions,
        mounted: bottom.mounted.length,
        glyphCalls: initialGlyphCalls,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

const report = JSON.stringify({ passed: results.length, cases: results }, null, 2);

await writeFile('artifacts/editor-checks.json', report + '\n');

console.log(report);
