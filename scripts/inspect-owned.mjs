import { chromium, firefox, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output = {};
await mkdir('artifacts', { recursive: true });
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch(); const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.OWNED_URL ?? 'http://127.0.0.1:5173/owned-layout.html');
  await page.waitForFunction(() => window.ownedSpike);
  output[name] = await page.evaluate(() => window.ownedSpike.audit());
  await page.screenshot({ path: `artifacts/owned-${name}.png`, fullPage: true });
  await page.locator('#input').fill('office café\nA second paragraph.');
  await page.locator('#width').fill('300');
  const metrics = JSON.parse(await page.locator('#results').textContent());
  output[name].checks.uiResizeWithoutShaping = metrics.shapeCallsThisRender === 0;
  for (let i = 0; i < 3; i++) await page.locator('canvas').nth(i).click({position:{x:45,y:25}});
  output[name].checks.uiCaret = await page.locator('#input').evaluate(input => input.selectionStart > 0);
  output[name].errors = errors;
  await browser.close();
}
await writeFile('artifacts/owned-layout.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
if (Object.values(output).some(o => o.errors.length || Object.values(o.checks).some(v => !v))) process.exitCode = 1;
