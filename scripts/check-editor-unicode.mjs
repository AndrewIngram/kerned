import assert from 'node:assert/strict';

import { chromium, firefox, webkit } from 'playwright';

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    const page = await browser.newPage(),
      errors = [];

    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:5173/editor.html');
    await page.waitForFunction(() => window.editorDiagnostics);

    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );

    const original = await page.evaluate(() => window.editorDiagnostics.read().nodes[0].text);

    for (const value of ['😀', '👍🏽', '👩‍💻', '👨‍👩‍👧‍👦', '🇬🇧', '1️⃣', '❤️', 'é', 'e\u0301', '🫩']) {
      await page.evaluate(() => window.editorDiagnostics.select(1, 0));
      await settle();
      await page.keyboard.insertText(value);
      await settle();
      assert.deepEqual(errors, [], 'Unicode must not crash rendering');
      assert.equal(await page.locator('.text-capture').count(), 1);
      assert.equal(
        await page.evaluate(() => window.editorDiagnostics.read().nodes[0].text),
        value + original,
      );
      await page.keyboard.press('Backspace');
      await settle();
      assert.equal(
        await page.evaluate(() => window.editorDiagnostics.read().nodes[0].text),
        original,
        'Backspace must remove one entire grapheme',
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settle();
      assert.equal(
        await page.evaluate(() => window.editorDiagnostics.read().nodes[0].text),
        value + original,
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settle();
      assert.equal(
        await page.evaluate(() => window.editorDiagnostics.read().nodes[0].text),
        original,
      );
    }

    await page.evaluate(() => window.editorDiagnostics.select(1, 0));
    await settle();
    await page.keyboard.insertText('😀 👍🏽 👩‍💻 🇬🇧 ❤️ café ');
    await settle();
    await page.screenshot({ path: `artifacts/editor-emoji-${name}.png` });
    // Unsupported scripts must leave the editor usable, without committing bad layout input.
    await page.keyboard.insertText('漢');
    await settle();
    assert.deepEqual(errors, []);
    assert.ok(
      !(await page.evaluate(() => window.editorDiagnostics.read().nodes[0].text)).includes('漢'),
    );
    await page.keyboard.insertText('OK');
    await settle();
    assert.deepEqual(errors, []);

    if (name === 'chromium') {
      const variants = await page.evaluate(async () => {
        const { default: initialize } = await import('/tests/fixtures/canvas-kit.js'),
          { createOwnedEngine } = await import('/src/owned-layout.ts');

        const kit = await initialize({ locateFile: () => '/engines/canvaskit.wasm' }),
          results = [];

        for (const storage of ['objects', 'packed', 'carets', 'shaping']) {
          const owned = await createOwnedEngine(kit, storage),
            surface = kit.MakeSurface(500, 200);

          const text = 'Bold 👩‍💻 and 🇬🇧 café 🜀';

          const layout = owned.layoutText({
            text,
            spans: [{ start: 0, end: text.length, bold: true, italic: false }],
            width: 400,
            size: 24,
          });

          layout.draw(surface.getCanvas(), 0, 0);
          surface.flush();
          results.push({
            storage,
            lines: layout.lines,
            caret: layout.geometry(text.length, text.length, false).caret,
          });
          layout.dispose();
          owned.destroy();
          surface.delete();
        }

        return results;
      });

      for (const result of variants) {
        assert.deepEqual(result.lines, variants[0].lines);
        assert.deepEqual(result.caret, variants[0].caret);
        assert.ok(result.caret.every(Number.isFinite));
      }
    }

    console.log(
      name,
      'emoji sequences, missing glyphs, accents, grapheme deletion, undo and safe unsupported input passed',
    );
  } finally {
    await browser.close();
  }
}
