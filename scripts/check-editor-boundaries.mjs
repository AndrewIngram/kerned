import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { dependencies } from './import-dependencies.mjs';

const layers = new Set(['model', 'transform', 'state']);

const allowed = { model: [], transform: ['model'], state: ['model', 'transform'] };

const sources = ['src', 'tests', 'scripts'].flatMap((root) =>
  readdirSync(root, { recursive: true })
    .filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file))
    .map((file) => `${root}/${file}`),
);

let checked = 0;

for (const file of sources) {
  const layer = file.startsWith('src/') ? file.split('/')[1] : null;
  const headless = layers.has(layer) && !file.includes('/__tests__/');

  for (const specifier of dependencies(file, readFileSync(file, 'utf8'))) {
    const target = specifier.startsWith('.')
      ? path.normalize(path.join(path.dirname(file), specifier))
      : specifier.startsWith('/src/')
        ? specifier.slice(1)
        : specifier;

    const targetLayer = target.startsWith('src/') ? target.split('/')[1] : null;

    assert.ok(!/^src\/editor(?:\/|$)/.test(target), `${file}: removed editor barrel: ${specifier}`);

    if (headless) {
      assert.ok(
        target === 'zod' ||
          target === '@standard-schema/spec' ||
          (targetLayer === layer && !target.includes('/__tests__/')) ||
          allowed[layer].includes(targetLayer),
        `${file}: ${layer} must not depend on ${specifier}`,
      );
    }

    if (layers.has(targetLayer) && targetLayer !== layer) {
      assert.ok(
        target === `src/${targetLayer}` || target === `src/${targetLayer}/index.ts`,
        `${file}: use the ${targetLayer} public entry point, not ${specifier}`,
      );
    }
  }

  if (headless) checked++;
}

for (const fixture of [
  'src/editor-extension-checks.ts',
  'src/editor-container-checks.ts',
  'src/editor-selection-checks.ts',
  'src/extensions/cell-selection.ts',
]) {
  for (const specifier of dependencies(fixture, readFileSync(fixture, 'utf8'))) {
    assert.ok(
      /^(?:\.\/|\.\.\/)(?:model|transform|state|editor-browser)$/.test(specifier) ||
        specifier.startsWith('./extensions/') ||
        // Attribute validators are consumer-owned Standard Schema implementations.
        specifier === 'zod',
      `${fixture}: independent fixture bypasses public entry points: ${specifier}`,
    );
  }
}

console.log(
  `Checked ${checked} headless modules and public imports across ${sources.length} files`,
);
