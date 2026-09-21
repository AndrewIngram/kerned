import { test, expect } from '@playwright/test';

test('clicking an atomic view selects it while interactive descendants retain native input', async ({
  page,
}) => {
  await page.goto('/extensions.html?stream=32');
  await page.waitForFunction(() => window.editorDiagnostics);
  await page.evaluate(() =>
    window.editorDiagnostics.scrollTo(
      window.editorDiagnostics.read().nodes.find((n) => n.kind === 'image').id,
    ),
  );

  const image = page
    .locator('[data-editor-node]')
    .filter({ has: page.locator('[data-image]') })
    .first();

  await image.scrollIntoViewIfNeeded();
  const id = Number(await image.getAttribute('data-editor-node'));
  await image.click();
  await expect(image).toHaveAttribute('data-selected', 'true');
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBe('node');
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBeUndefined();
  await page.keyboard.press('ArrowRight');
  await expect(image).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBeUndefined();
  await image.click();
  await page.keyboard.press('Shift+ArrowRight');
  const extended = await page.evaluate(() => window.editorDiagnostics.read().selection);
  expect(extended.type).toBe('range');
  expect(extended.anchor.id).toBe(id);
  await expect(image).toHaveAttribute('data-selected', 'true');
  await image.click();
  await page.keyboard.press('PageDown');
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBeUndefined();
  await page.evaluate((idValue) => window.editorDiagnostics.scrollTo(idValue), id);
  await image.click();
  await page.keyboard.press('Control+End');
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBeUndefined();
  await page.evaluate((idValue2) => window.editorDiagnostics.scrollTo(idValue2), id);
  await image.click();
  await page.evaluate(() =>
    window.editorDiagnostics.scrollTo(
      window.editorDiagnostics.read().nodes.find((n) => n.kind === 'checklist').id,
    ),
  );
  const checklist = page.locator('[data-widget]').first();
  await checklist.scrollIntoViewIfNeeded();
  const checkbox = checklist.locator('input[type=checkbox]').first();
  const checked = await checkbox.isChecked();
  await checkbox.click();
  expect(await checkbox.isChecked()).toBe(!checked);
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBe('node');
  expect(id).toBeGreaterThan(0);
});
