import { expect, test } from '@playwright/test';

test('Chinese book streams, remains editable and loads its fonts only when selected', async ({
  page,
}) => {
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/editor.html');
  await page.waitForFunction(() => window.editorDiagnostics);
  expect(requests.filter((url) => url.includes('NotoSansCJKtc'))).toEqual([]);
  const picker = page.getByLabel('Sample', { exact: true });
  await picker.selectOption('journey-to-the-west');
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics?.read().nodes[0]?.text))
    .toBe('西遊記');
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes.length), {
      timeout: 30000,
    })
    .toBe(2968);
  expect(
    await page.evaluate(() => window.editorDiagnostics.metrics().residentParagraphs),
  ).toBeLessThan(100);
  await page.evaluate(() => {
    const node = window.editorDiagnostics.read().nodes[100];
    window.editorDiagnostics.select(node.id, 0);
  });
  await page.keyboard.insertText('中文測試。');
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics.read().nodes[100].text))
    .toMatch(/^中文測試。/);
  const fontRequests = requests.filter((url) => url.includes('NotoSansCJKtc'));
  expect(fontRequests).toHaveLength(2);
  await picker.selectOption('minimal');
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics?.read().nodes.length))
    .toBe(4);
  await picker.selectOption('journey-to-the-west');
  await expect
    .poll(() => page.evaluate(() => window.editorDiagnostics?.read().nodes[0]?.text))
    .toBe('西遊記');
  expect(requests.filter((url) => url.includes('NotoSansCJKtc'))).toEqual(fontRequests);
  expect(errors).toEqual([]);
});
