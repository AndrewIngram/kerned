import { test, expect } from '@playwright/test';

test('extension diagnostics retain mentions and editable table cells', async ({ page }) => {
  await page.goto('/extensions.html');
  await page.waitForFunction(() => window.editorDiagnostics);
  await page.getByLabel('Open @Maya Chen').click();
  await expect(page.getByRole('dialog')).toContainText('Design team');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Editor text input')).toBeFocused();
  const table = page.locator('[data-table="3"]');
  await table.getByRole('button', { name: 'Edit cell 1, 1', exact: true }).click();
  const notes = table.getByLabel('Cell 1, 1 text', { exact: true });
  await notes.fill('Keep focus');
  await expect(notes).toBeFocused();
  await page.keyboard.type(' while typing');
  await expect(notes).toHaveValue('Keep focus while typing');
  await expect(notes).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(notes).toHaveValue('Keep the first release focused.');
});

test('comments remain external through replies, text edits, undo and rich paste', async ({
  page,
}) => {
  await page.goto('/editor.html');
  await page.waitForFunction(() => window.editorDiagnostics);
  await page.evaluate(() => window.editorDiagnostics.select(1, 0));
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const before = await page.evaluate(() => ({
    comments: window.editorDiagnostics.comments(),
    history: window.editorDiagnostics.history(),
    nodes: window.editorDiagnostics.read().nodes,
  }));

  expect(before.comments.resolved[0].ranges).toHaveLength(4);
  expect(before.nodes.every((node) => !('comments' in node))).toBe(true);
  await page.getByLabel('Reply', { exact: true }).fill('Keep this discussion');

  const replied = await page.evaluate(() => ({
    comments: window.editorDiagnostics.comments(),
    history: window.editorDiagnostics.history(),
  }));

  expect(replied.comments.revision).toBe(before.comments.revision);
  expect(replied.history).toEqual(before.history);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.editorDiagnostics.select(1, 10));
  await page.keyboard.type('new');
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics.comments().resolved[0].ranges[0].to))
    .toBe(before.comments.resolved[0].ranges[0].to + 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics.comments().resolved[0].ranges))
    .toEqual(before.comments.resolved[0].ranges);
  expect(
    await page.evaluate(() => window.editorDiagnostics.comments().threads[0].messages[0].reply),
  ).toBe('Keep this discussion');
  await page.evaluate(() => {
    const input = document.querySelector('[data-editor-input]');
    window.editorDiagnostics.select(1, 0);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    );
  });
  await page.evaluate(() => {
    const input = document.querySelector('[data-editor-input]'),
      data = new DataTransfer();

    const event = new ClipboardEvent('copy', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(event);
    const last = window.editorDiagnostics.read().nodes.at(-1);
    window.editorDiagnostics.select(last.id, last.text.length);
    window.commentClipboard = Object.fromEntries(
      [...event.clipboardData.types].map((type) => [type, event.clipboardData.getData(type)]),
    );
  });
  await page.evaluate(() => {
    const event = new ClipboardEvent('paste', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    });

    for (const [type, value] of Object.entries(window.commentClipboard))
      event.clipboardData.setData(type, value);
    document.querySelector('[data-editor-input]').dispatchEvent(event);
  });
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes.length))
    .toBeGreaterThan(4);
  expect(await page.evaluate(() => window.editorDiagnostics.comments().threads.length)).toBe(1);
});
