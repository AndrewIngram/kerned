import { chromium, firefox, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
const shaping = process.env.OWNED_VARIANT === 'shaping';
const carets = process.env.OWNED_VARIANT === 'carets';
const artifact = shaping ? 'artifacts/owned-shaping-validation.json' : carets ? 'artifacts/owned-caret-validation.json' : 'artifacts/owned-size-validation.json';
const output = { recordedAt: new Date().toISOString(), host: os.cpus()[0]?.model, browsers: {} };
await mkdir('artifacts', { recursive: true });
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.OWNED_URL ?? 'http://127.0.0.1:5175/owned-layout.html');
    await page.waitForFunction(() => window.ownedSpike);
    const validation = await page.evaluate(({carets,shaping}) => shaping ? window.ownedSpike.validateShaping() : carets ? window.ownedSpike.validateCarets() : window.ownedSpike.validateSizes(), {carets,shaping});
    output.browsers[name] = { version: browser.version(), validation, errors };
    await writeFile(artifact, JSON.stringify(output, null, 2) + '\n');
    console.log(name, JSON.stringify(validation));
    if (validation.failures.length || errors.length) { process.exitCode = 1; continue; }
    const benchmark = await page.evaluate(({carets,shaping}) => shaping ? window.ownedSpike.benchmarkShaping() : carets ? window.ownedSpike.benchmarkCarets() : window.ownedSpike.benchmarkStorage(), {carets,shaping});
    output.browsers[name].benchmark = benchmark;
    if (errors.length) process.exitCode = 1;
    await writeFile(artifact, JSON.stringify(output, null, 2) + '\n');
    for (const result of benchmark.results) {
      console.log(`${name} ${result.fixture.name} ${result.scenario}: ` + result.variants.map(v => `${v.name} ${v.medianMs.toFixed(2)}/${v.p95Ms.toFixed(2)}ms`).join(' | '));
      if (!result.countsPassed) process.exitCode = 1;
    }
  } finally { await browser.close(); }
}
