import { test, expect } from '@playwright/test';

test('image comments use the public range API and open from their decoration', async ({ page }) => {
  await page.goto('/editor.html?stream=32');
  await page.waitForFunction(() => window.editorDiagnostics);

  const id = await page.evaluate(() => {
    const node = window.editorDiagnostics.read().nodes.find((n) => n.kind === 'image');
    window.editorDiagnostics.scrollTo(node.id);

    return node.id;
  });

  const image = page.locator(`[data-image="${id}"]`);
  await image.scrollIntoViewIfNeeded();
  await image.click();
  const add = page.getByRole('button', { name: 'Add comment', exact: true });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.locator(`[data-commented-node="${id}"]`)).toBeVisible();
  await expect(page.locator('.nearby-panel')).toBeVisible();
  await page.locator('.close-panel').click();
  await image.click();
  await expect(page.locator('.nearby-panel')).toBeVisible();
  await page.locator('.close-panel').click();
  await page.evaluate((idValue) => {
    const nodes = window.editorDiagnostics.read().nodes,
      i = nodes.findIndex((n) => n.id === idValue);

    window.editorDiagnostics.select(nodes[i - 1].id, 0);
  }, id);
  await image.click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.editorDiagnostics.read().selection.type)).toBe('range');
});
