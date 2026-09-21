import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/editor.html');
  await page.waitForFunction(() => window.editorDiagnostics);
});

test('caret toolbar formats subsequent typing and Enter without a document edit on toggle', async ({
  page,
}) => {
  await page.evaluate(() => window.editorDiagnostics.select(1, 0));
  const bold = page.getByRole('button', { name: 'Bold', exact: true });

  const before = await page.evaluate(() => ({
    revision: window.editorDiagnostics.comments().revision,
    history: window.editorDiagnostics.history(),
  }));

  await expect(bold).toBeEnabled();
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.evaluate(() => ({
      revision: window.editorDiagnostics.comments().revision,
      history: window.editorDiagnostics.history(),
    })),
  ).toEqual(before);
  await page.keyboard.type('Bold');
  await page.keyboard.press('Enter');
  await page.keyboard.type('More');
  let nodes = await page.evaluate(() => window.editorDiagnostics.read().nodes);
  expect(nodes[0].text).toBe('Bold');
  expect(nodes[0].marks.some((s) => s.mark.type === 'bold' && s.from === 0 && s.to === 4)).toBe(
    true,
  );
  expect(nodes[1].text.startsWith('More')).toBe(true);
  expect(nodes[1].marks.some((s) => s.mark.type === 'bold' && s.from === 0 && s.to === 4)).toBe(
    true,
  );
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.type('plain');
  nodes = await page.evaluate(() => window.editorDiagnostics.read().nodes);
  expect(nodes[1].marks.filter((s) => s.mark.type === 'bold').every((s) => s.to <= 4)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.editorDiagnostics.select(1, 0));
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.editorDiagnostics.select(3, 1));
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
});

test('caret formatting retains table input focus and formats cell text', async ({ page }) => {
  await page.locator('.table-menu summary').click();
  await page.getByRole('button', { name: 'Table (3 × 3)', exact: true }).click();
  await page.getByRole('button', { name: 'Edit cell 1, 1', exact: true }).click();
  const input = page.getByLabel('Cell 1, 1 text', { exact: true });
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(input).toBeFocused();
  await page.keyboard.type('Bold cell');

  const cell = await page.evaluate(
    () =>
      window.editorDiagnostics.read().nodes.find((n) => n.kind === 'table').rows[0][0]
        .paragraphs[0],
  );

  expect(cell.text).toBe('Bold cell');
  expect(cell.marks.some((s) => s.mark.type === 'bold' && s.from === 0 && s.to === 9)).toBe(true);
});
