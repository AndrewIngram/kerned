import {test, expect} from '@playwright/test';

test('retained core, extension and inline-layout contracts', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/hybrid-editor.html');
  await page.waitForFunction(() => window.hybridSpike);
  const results = await page.evaluate(() => {
    const editor = window.hybridSpike;
    return {
      extensions: editor.checkExtensions(),
      containers: editor.checkContainers(),
      selections: editor.checkSelections(),
      transactions: editor.checkTransactions(),
      inline: editor.checkInline(),
    };
  });
  for (const result of Object.values(results)) expect(result.assertions).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('extension diagnostics retain mentions and editable React checklists', async ({page}) => {
  await page.goto('/hybrid-editor.html');
  await page.waitForFunction(() => window.hybridSpike);
  await page.getByLabel('Open @Maya Chen').click();
  await expect(page.getByRole('dialog')).toContainText('Design team');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Canvas text input')).toBeFocused();
  const checklist = page.locator('[data-widget="3"]');
  await checklist.getByLabel('Review the examples').check();
  await expect.poll(() => page.evaluate(() => window.hybridSpike.read().nodes
    .find(node => node.id === 3).checked[1])).toBe(true);
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(checklist.getByLabel('Review the examples')).not.toBeChecked();
});
