import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [vitestPath, playwrightPath, relocationPath] = process.argv.slice(2);

assert.ok(
  vitestPath && playwrightPath && relocationPath,
  'Pass executed Vitest JSON, collected Playwright JSON, and an explicit test relocation map',
);

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

const baseline = read('artifacts/public-interface-m0/test-identities.json');

const relocations = read(relocationPath);

const current = read(vitestPath);

const e2e = read(playwrightPath);

const vitest = current.testResults.flatMap((file) =>
  file.assertionResults.map((test) => ({
    file: path.relative(process.cwd(), file.name),
    name: test.fullName,
    status: test.status,
  })),
);

const playwright = [];

function collect(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests)
      playwright.push({ file: spec.file, name: spec.title, project: test.projectName });
  }

  for (const child of suite.suites ?? []) collect(child);
}

for (const suite of e2e.suites) collect(suite);

function requirePreserved(previous, actual) {
  const identities = new Map();

  for (const item of actual) {
    const key = JSON.stringify(item);
    identities.set(key, (identities.get(key) ?? 0) + 1);
  }

  for (const item of previous) {
    const moved = {
      ...item,
      file: relocations.files[item.file] ?? item.file,
      name: relocations.testNames[item.name] ?? item.name,
    };

    const key = JSON.stringify(moved);
    const count = identities.get(key) ?? 0;
    assert.ok(count > 0, `Lost test identity or status: ${key}`);
    identities.set(key, count - 1);
  }
}

requirePreserved(baseline.vitest, vitest);

requirePreserved(baseline.e2e, playwright);

console.log(
  `Preserved ${baseline.vitest.length} executed Vitest and ${baseline.e2e.length} collected E2E identities; current totals ${vitest.length}/${playwright.length}`,
);
