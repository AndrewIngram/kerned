import assert from 'node:assert/strict';

import { chromium, firefox, webkit } from 'playwright';

const url = process.env.EDITOR_URL ?? 'http://127.0.0.1:5173/extensions.html';

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }),
      errors = [];

    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.editorDiagnostics);

    const canvas = page.getByLabel('Canvas document'),
      input = page.getByLabel('Editor text input');

    const read = () => page.evaluate(() => window.editorDiagnostics.read());

    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );

    const initialBounds = await canvas.boundingBox();
    await page.mouse.click(initialBounds.x + 40, initialBounds.y + 42);
    await settle();
    assert.ok(
      await input.evaluate((el) => el === document.activeElement),
      `${name}: clicking canvas must retain input focus`,
    );

    const before = await read(),
      at = before.selection.focus;

    await page.keyboard.type('TEST');
    await settle();
    assert.equal(
      (await read()).nodes[0].text,
      before.nodes[0].text.slice(0, at) + 'TEST' + before.nodes[0].text.slice(at),
      `${name}: click then type`,
    );
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settle();

    for (const zoom of ['1', '1.5']) {
      await page.getByLabel('Zoom').selectOption(zoom);
      await settle();

      const box = await canvas.boundingBox(),
        scale = Number(zoom);

      const start = { x: box.x + 40 * scale, y: box.y + 42 * scale },
        end = { x: box.x + 130 * scale, y: start.y };

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 10 });
      await page.mouse.up();
      await settle();

      const state = await read(),
        selection = state.selection;

      assert.notEqual(selection.anchor, selection.focus, `${name}: drag must select visible text`);
      assert.ok(
        await input.evaluate((el) => el === document.activeElement),
        `${name}: drag retains input focus`,
      );
      await canvas.screenshot({ path: `artifacts/pointer-${name}-${zoom}.png` });
      await page.keyboard.type('X');
      await settle();

      const from = Math.min(selection.anchor, selection.focus),
        to = Math.max(selection.anchor, selection.focus);

      assert.equal(
        (await read()).nodes[0].text,
        state.nodes[0].text.slice(0, from) + 'X' + state.nodes[0].text.slice(to),
        `${name}: typing replaces drag selection`,
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settle();
    }

    await page.getByLabel('Zoom').selectOption('1');
    await settle();
    const highlight = page.getByLabel('Open comment on highlighted text').first();
    const rect = await highlight.boundingBox();
    await page.mouse.click(rect.x + rect.width * 0.2, rect.y + rect.height / 2);
    await settle();
    const left = (await read()).selection;
    assert.ok(
      await input.evaluate((el) => el === document.activeElement),
      `${name}: comment click retains text focus`,
    );
    await page.mouse.click(rect.x + rect.width * 0.75, rect.y + rect.height / 2);
    await settle();
    const right = (await read()).selection;
    assert.equal(right.id, 2);
    assert.ok(right.focus > left.focus, `${name}: comment click uses exact text hit position`);
    assert.ok(await page.getByRole('dialog', { name: 'Comment', exact: true }).isVisible());
    const original = (await read()).nodes.find((n) => n.id === 2).text;
    await page.keyboard.type('X');
    await settle();
    assert.equal(
      (await read()).nodes.find((n) => n.id === 2).text,
      original.slice(0, right.focus) + 'X' + original.slice(right.focus),
    );
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settle();
    await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.75, rect.y + rect.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle();
    const dragged = (await read()).selection;
    assert.ok(dragged.focus > dragged.anchor, `${name}: drag within comment selects text`);
    await page.keyboard.press('Escape');
    await highlight.focus();
    await page.keyboard.press('Enter');
    await settle();
    assert.ok(
      await page
        .getByRole('button', { name: 'Close', exact: true })
        .evaluate((el) => el === document.activeElement),
      `${name}: keyboard activation still focuses comment panel`,
    );
    assert.deepEqual(errors, []);
    console.log(name, 'click, type, drag, replace and undo passed');
  } finally {
    await browser.close();
  }
}
