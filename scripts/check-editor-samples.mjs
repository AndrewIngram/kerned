import assert from 'node:assert/strict';

import { chromium, firefox, webkit } from 'playwright';

for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();

  try {
    const page = await browser.newPage(),
      errors = [],
      requests = [];

    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('http://127.0.0.1:5173/editor.html');
    await page.waitForFunction(() => window.editorDiagnostics);
    const origin = await page.evaluate(() => performance.timeOrigin);
    requests.length = 0;
    const picker = page.getByLabel('Sample', { exact: true });

    for (let i = 0; i < 2; i++) {
      await picker.selectOption('warbreaker');
      await page.waitForFunction(
        () =>
          new URL(location.href).searchParams.get('sample') === 'warbreaker' &&
          document.querySelector('select')?.disabled === false,
      );
      await page.waitForFunction(
        () =>
          window.editorDiagnostics.read().nodes.length > 4 &&
          !window.editorDiagnostics.read().nodes[0].text.startsWith('Good ideas'),
      );
      await picker.selectOption('minimal');
      await page.waitForFunction(
        () => !location.search && document.querySelector('select')?.disabled === false,
      );
      await page.waitForFunction(() => window.editorDiagnostics.read().nodes.length === 4);
    }

    assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
    assert.equal(requests.filter((url) => url.endsWith('/samples/warbreaker.html')).length, 1);
    assert.deepEqual(
      requests.filter((url) => !url.endsWith('/samples/warbreaker.html')),
      [],
    );
    await page.goBack();
    await page.waitForFunction(
      () =>
        window.editorDiagnostics.read().nodes.length > 4 &&
        !window.editorDiagnostics.read().nodes[0].text.startsWith('Good ideas'),
    );
    await page.goForward();
    await page.waitForFunction(() => window.editorDiagnostics.read().nodes.length === 4);
    await page.evaluate(() => window.editorDiagnostics.select(1, 0));
    await page.keyboard.type('Still editable. ');
    assert.ok(
      await page.evaluate(() =>
        window.editorDiagnostics.read().nodes[0].text.startsWith('Still editable. '),
      ),
    );
    assert.deepEqual(errors, []);
    console.log(name, 'in-place switching, cached book, back/forward and editing passed');
  } finally {
    await browser.close();
  }
}
