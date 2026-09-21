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
