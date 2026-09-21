import assert from 'node:assert/strict';

import { chromium, firefox, webkit } from 'playwright';

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    const page = await browser.newPage(),
      errors = [];

    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:5173/editor.html?sample=warbreaker');
    await page.waitForFunction(() => window.editorDiagnostics?.probe([]).complete);
    await page.evaluate(() => window.editorDiagnostics.select(1, 0));
    await page.keyboard.press('ControlOrMeta+a');

    const text = await page.locator('[data-editor-input]').evaluate((el) => {
      const event = new ClipboardEvent('copy', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      });

      el.dispatchEvent(event);

      return event.clipboardData.getData('text/plain');
    });

    assert.ok(text.length > 1_000_000, 'Must copy the complete book');
    await page.goto('http://127.0.0.1:5173/editor.html');
    await page.waitForFunction(() => window.editorDiagnostics);
    await page.evaluate(() => window.editorDiagnostics.select(1, 0));
    await page.keyboard.press('ControlOrMeta+a');
    await page.locator('[data-editor-input]').evaluate((el, textValue) => {
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      });

      event.clipboardData.setData('text/plain', textValue);
      el.dispatchEvent(event);
    }, text);
    assert.equal(await page.locator('.input-notice').innerText(), '');
    const expected = text.replace(/\t/g, ' ').split('\n');

    const pasted = await page.evaluate(() =>
      window.editorDiagnostics.read().nodes.map((n) => n.text),
    );

    assert.deepEqual(pasted, expected, 'Every copied paragraph must survive paste');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await page.evaluate(() => window.editorDiagnostics.read().nodes.length), 4);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => window.editorDiagnostics.read().nodes.map((n) => n.text)),
      expected,
    );
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    const original = await page.evaluate(() => window.editorDiagnostics.read().nodes[0].text);

    for (const value of ['A\tB', 'one\r\ntwo\n\nthree\n']) {
      await page.evaluate(() => window.editorDiagnostics.select(1, 5));
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.locator('[data-editor-input]').evaluate((el, textValue2) => {
        const event = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: new DataTransfer(),
        });

        event.clipboardData.setData('text/plain', textValue2);
        el.dispatchEvent(event);
      }, value);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(await page.locator('.input-notice').innerText(), '');
      const lines = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').split('\n');
      lines[0] = original.slice(0, 5) + lines[0];
      lines[lines.length - 1] += original.slice(5);
      assert.deepEqual(
        await page.evaluate(
          (count) =>
            window.editorDiagnostics
              .read()
              .nodes.slice(0, count)
              .map((n) => n.text),
          lines.length,
        ),
        lines,
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.equal(
        await page.evaluate(() => window.editorDiagnostics.read().nodes[0].text),
        original,
      );
    }

    assert.deepEqual(errors, []);
    console.log(
      name,
      'full book copy/paste, exact text, tabs, CRLF, blank paragraphs, suffix and undo/redo passed',
    );
  } finally {
    await browser.close();
  }
}
