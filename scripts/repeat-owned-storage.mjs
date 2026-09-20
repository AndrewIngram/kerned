import { chromium, firefox, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const report = { recordedAt: new Date().toISOString(), browsers: {} };
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.OWNED_URL ?? 'http://127.0.0.1:5175/owned-layout.html');
    await page.waitForFunction(() => window.ownedSpike);
    const benchmark = await page.evaluate(() => window.ownedSpike.benchmarkStorage());
    if (errors.length || benchmark.results.some(row => !row.countsPassed)) throw new Error(`Failed checks: ${name} ${errors}`);
    report.browsers[name] = { version: browser.version(), benchmark, errors };
    await writeFile('artifacts/owned-storage-repeat.json', JSON.stringify(report, null, 2)+'\n');
    for (const row of benchmark.results) console.log(`${name} ${row.fixture.name} ${row.scenario}: `+row.variants.map(v=>`${v.name} ${v.medianMs.toFixed(2)}/${v.p95Ms.toFixed(2)}`).join(' | '));
  } finally { await browser.close(); }
}
