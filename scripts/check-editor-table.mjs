import assert from 'node:assert/strict';

import { chromium, firefox, webkit } from 'playwright';

const base = process.env.EDITOR_URL ?? 'http://127.0.0.1:5176/extensions.html';

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 950 } }),
      errors = [];

    page.on('pageerror', (e) => errors.push(e.message));
    const url = new URL(base);
    url.search = 'sample=warbreaker';
    await page.goto(url.href);
    await page.waitForFunction(() => window.editorDiagnostics);

    const imported = await page.evaluate(() =>
      window.editorDiagnostics.importHtml(
        '<p>Before</p><table><caption>Example</caption><tr><th colspan="2">Title</th></tr><tr><td rowspan="2"><strong>A</strong></td><td>B</td></tr><tr><td><u>C</u></td></tr></table><p>After</p>',
      ),
    );

    assert.deepEqual(
      imported.nodes.map((n) => n.kind),
      ['paragraph', 'table', 'paragraph'],
      'HTML tables must remain a table block',
    );
    const table = imported.nodes[1];
    assert.equal(table.caption, 'Example');
    assert.equal(table.rows.length, 3);
    assert.equal(table.rows[0][0].colspan, 2);
    assert.equal(table.rows[0][0].header, true);
    assert.equal(table.rows[1][0].rowspan, 2);
    assert.equal(table.rows[1][0].paragraphs[0].marks[0].mark.type === 'bold', true);
    assert.equal(table.rows[2][0].paragraphs[0].marks[0].mark.type === 'underline', true);
    await page.waitForFunction(() => window.editorDiagnostics.probe([]).complete, null, {
      timeout: 90000,
    });

    const bookTable = await page.evaluate(() =>
      window.editorDiagnostics.read().nodes.find((n) => n.kind === 'table'),
    );

    assert.ok(bookTable);
    assert.equal(bookTable.rows.length, 11);
    assert.equal(bookTable.rows.flat().length, 33);
    await page.evaluate((id) => window.editorDiagnostics.scrollTo(id), bookTable.id);
    const rendered = page.locator(`[data-table="${bookTable.id}"]`);
    await rendered.waitFor();
    assert.equal(await rendered.locator('tr').count(), 11);
    assert.equal(await rendered.locator('td,th').count(), 33);
    assert.match(await rendered.innerText(), /Aura Recognition/);

    for (const [width, zoom] of [
      [1100, '1'],
      [420, '1.5'],
    ]) {
      await page.setViewportSize({ width, height: 950 });
      await page.getByLabel('Zoom').selectOption(zoom);
      await page.waitForFunction(
        () => window.editorDiagnostics.probe([]).reflowPending === 0,
        null,
        { timeout: 90000 },
      );
      await page.evaluate((id) => window.editorDiagnostics.scrollTo(id), bookTable.id);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );

      const geometry = await rendered.evaluate((el) => {
        const s = window.editorDiagnostics.read(),
          id = Number(el.dataset.table),
          p = s.scene.find((p) => p.id === id),
          next = s.scene[s.scene.findIndex((pValue) => pValue.id === id) + 1],
          r = el.getBoundingClientRect();

        return {
          height: r.height / s.zoom,
          expected: p.height,
          gap: next.y - p.y - p.height,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });

      assert.ok(Math.abs(geometry.height - geometry.expected) < 1.5, JSON.stringify(geometry));
      assert.equal(geometry.gap, 24);
      assert.equal(geometry.overflow, false);
      await page.screenshot({ path: `artifacts/warbreaker-table-${name}-${width}.png` });
    }

    assert.deepEqual(errors, []);
    console.log(`${name}: table import, spans, book grid and measured layout passed`);
  } finally {
    await browser.close();
  }
}
