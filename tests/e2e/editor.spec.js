import { test, expect } from '@playwright/test';

for (const width of [1100, 390]) {
  test(`writing demo edits and formats text at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/editor.html');
    await page.waitForFunction(() => window.editorDiagnostics);
    await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
    const original = await page.evaluate(() => window.editorDiagnostics.read().nodes);
    const canvas = page.getByLabel('Canvas document');
    const box = await canvas.boundingBox();
    const first = await page.evaluate(() => window.editorDiagnostics.read().scene[0]);
    await page.mouse.click(box.x + 30, box.y + first.y + 12);
    await expect(page.getByLabel('Canvas text input')).toBeFocused();
    await page.keyboard.type('Hello ');
    await expect
      .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes[0].text))
      .toBe(`Hello ${original[0].text}`);

    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.editorDiagnostics
            .read()
            .nodes[0].marks.some(
              (span) => span.mark.type === 'bold' && span.from === 0 && span.to === 6,
            ),
        ),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes[0].marks))
      .toEqual(original[0].marks);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes))
      .toEqual(original);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test('the site root opens the writing demo and preserves query parameters', async ({ page }) => {
  await page.goto('/?sample=minimal#draft');
  await expect(page).toHaveURL(/\/editor\.html\?sample=minimal#draft$/);
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
});

test('sample replacement releases only the old layout owner and keeps assets resident', async ({
  page,
}) => {
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor.html');
  await page.waitForFunction(() => window.editorDiagnostics);

  const witness = await page.evaluate(() => {
    // Document/realm identity proves no reload without depending on timer precision.
    window.sampleNavigationWitness = { document, token: crypto.randomUUID() };

    return window.sampleNavigationWitness.token;
  });

  page.on('request', (request) => requests.push(request.url()));
  const picker = page.getByLabel('Sample', { exact: true });

  for (let iteration = 0; iteration < 2; iteration++) {
    await picker.selectOption('warbreaker');
    await expect(picker).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes.length))
      .toBeGreaterThan(4);
    await picker.selectOption('minimal');
    await expect(picker).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes.length))
      .toBe(4);
    await expect
      .poll(() => page.evaluate(() => window.editorDiagnostics.metrics().retention))
      .toEqual({ owners: 1, documents: 4, paragraphVariants: 4 });
  }

  await page.goBack();
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes.length))
    .toBeGreaterThan(4);
  await page.goForward();
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes.length))
    .toBe(4);
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics.metrics().retention.owners))
    .toBe(1);
  await page.evaluate(() => window.editorDiagnostics.select(1, 0));
  await page.keyboard.type('Still editable. ');
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes[0].text))
    .toMatch(/^Still editable\./);
  expect(
    await page.evaluate(
      (token) =>
        window.sampleNavigationWitness?.document === document &&
        window.sampleNavigationWitness.token === token,
      witness,
    ),
  ).toBe(true);
  expect(requests.filter((url) => url.endsWith('/samples/warbreaker.html'))).toHaveLength(1);
  expect(requests.filter((url) => /\.(wasm|ttf)(?:\?|$)/.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});
