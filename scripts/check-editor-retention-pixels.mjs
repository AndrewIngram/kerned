import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { chromium } from 'playwright';

const base = process.env.EDITOR_URL ?? 'http://127.0.0.1:5176/extensions.html';

const browser = await chromium.launch(),
  results = [];

try {
  const pages = [];

  for (const retention of ['all', 'viewport']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
    await page.goto(`${base}?stream=10000&retention=${retention}`);
    await page.waitForFunction(() => window.editorDiagnostics?.probe([]).complete);
    pages.push(page);
  }

  for (const id of [5011, 10005, 1]) {
    const images = [];

    for (const [i, page] of pages.entries()) {
      await page.evaluate((idValue) => window.editorDiagnostics.scrollTo(idValue), id);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      images.push(
        await page
          .locator('[data-editor-view]')
          .screenshot({ path: `artifacts/editor-retention-${id}-${i}.png` }),
      );
    }

    assert.ok(images[0].equals(images[1]), `Rendered pixels differ at ${id}`);
    results.push({ id, identical: true, bytes: images[0].length });
  }

  await writeFile(
    'artifacts/editor-retention-pixels.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(results);
} finally {
  await browser.close();
}
