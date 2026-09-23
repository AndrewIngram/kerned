import { test, expect } from '@playwright/test';

test('table view routes copy, paste and cut through rich clipboard commands', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/editor.html');
  await page.waitForFunction(() => window.editorDiagnostics);
  await page.locator('summary[aria-label="Table"]').click();
  await page.getByRole('button', { name: 'Table (3 × 3)', exact: true }).click();
  await page.getByRole('button', { name: 'Edit cell 1, 1', exact: true }).click();
  await page.getByLabel('Cell 1, 1 text', { exact: true }).fill('Alice');
  await page.getByRole('button', { name: 'Select cell 1, 1', exact: true }).click();
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page
    .getByRole('button', { name: 'Select cell 2, 2', exact: true })
    .click({ modifiers: ['Shift'] });

  const copied = await page.evaluate(() => {
    const event = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    });

    document.querySelector('[data-table]').dispatchEvent(event);

    return {
      html: event.clipboardData.getData('text/html'),
      text: event.clipboardData.getData('text/plain'),
      token: event.clipboardData.getData('application/x-kerned-fragment'),
    };
  });

  expect(copied.html).toContain('<strong>Alice</strong>');
  await page.getByRole('button', { name: 'Select cell 3, 3', exact: true }).click();
  await page.evaluate((copiedValue) => {
    const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }),
      data = event.clipboardData;

    data.setData('text/html', copiedValue.html);
    data.setData('text/plain', copiedValue.text);
    data.setData('application/x-kerned-fragment', copiedValue.token);
    document.querySelector('[data-table]').dispatchEvent(event);
  }, copied);
  await expect(page.locator('[data-table] tr')).toHaveCount(4);
  await expect(
    page.getByRole('document', { name: 'Document reading view' }).getByRole('row'),
  ).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Edit cell 3, 3', exact: true })).toHaveText(
    'Alice',
  );
  await expect(page.locator('[data-cell][data-selected="true"]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-table] tr')).toHaveCount(3);
  await expect(
    page.getByRole('document', { name: 'Document reading view' }).getByRole('row'),
  ).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('[data-table] tr')).toHaveCount(4);
  await expect(
    page.getByRole('document', { name: 'Document reading view' }).getByRole('row'),
  ).toHaveCount(4);
  await page.evaluate(() =>
    document.querySelector('[data-table]').dispatchEvent(
      new ClipboardEvent('cut', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }),
    ),
  );
  await expect(page.getByRole('button', { name: 'Edit cell 3, 3', exact: true })).not.toHaveText(
    'Alice',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit cell 3, 3', exact: true })).toHaveText(
    'Alice',
  );
  expect(errors).toEqual([]);
});
