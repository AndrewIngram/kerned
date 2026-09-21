import assert from 'node:assert/strict';

import { chromium, firefox, webkit } from 'playwright';

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } }),
        errors = [];

      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://127.0.0.1:5173/editor.html?stream=100');
      await page.waitForFunction(() => window.editorDiagnostics?.read().nodes.length === 100);

      const settle = () =>
        page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );

      await settle();
      await page.mouse.move(8, 400);
      await page.mouse.wheel(0, 1100);
      await page.waitForFunction(() => scrollY > 500);
      await settle();

      const geometry = await page.evaluate(() => ({
        page: scrollY,
        inset: document.querySelector('.document-scroll').scrollTop,
        toolbar: document.querySelector('.minimal-toolbar').getBoundingClientRect().top,
        toolbarHeight: document.querySelector('.minimal-toolbar').getBoundingClientRect().height,
        canvas: document.querySelector('canvas').getBoundingClientRect().top,
        rendered: window.editorDiagnostics.read().scroll,
      }));

      assert.equal(geometry.inset, 0);
      assert.equal(geometry.toolbar, 0);
      assert.equal(geometry.canvas, geometry.toolbarHeight);
      assert.ok(Math.abs(geometry.page - geometry.rendered) < 1);

      const target = await page.evaluate(() => {
        const s = window.editorDiagnostics.read();

        const p = s.scene.find(
          (p) =>
            p.y > s.scroll + 30 &&
            p.y < s.scroll + 250 &&
            s.nodes.find((n) => n.id === p.id)?.kind === 'paragraph',
        );

        const c = document.querySelector('canvas').getBoundingClientRect();

        return { id: p.id, x: c.left + 80, y: c.top + p.y - s.scroll + 12 };
      });

      await page.mouse.click(target.x, target.y);
      await settle();
      assert.equal(
        await page.evaluate(() => window.editorDiagnostics.read().selection.id),
        target.id,
      );
      await page.keyboard.type('test');
      await settle();
      assert.ok(
        await page.evaluate(
          (id) =>
            window.editorDiagnostics
              .read()
              .nodes.find((n) => n.id === id)
              .text.includes('test'),
          target.id,
        ),
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settle();
      await page.setViewportSize({ width: width === 1100 ? 760 : 420, height: 650 });
      await settle();
      assert.equal(
        await page.locator('canvas').evaluate((el) => el.getBoundingClientRect().height),
        650 -
          (await page
            .locator('.minimal-toolbar')
            .evaluate((el) => el.getBoundingClientRect().height)),
      );
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await settle();
      assert.equal(
        await page.locator('.minimal-toolbar').evaluate((el) => el.getBoundingClientRect().top),
        0,
      );
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/page-scroll-${name}-${width}.png` });
      console.log(
        name,
        width,
        'page scrolling, sticky toolbar, canvas hit testing and resize passed',
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
