import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { dependencies } from './import-dependencies.mjs';

const layers = new Set(['model', 'transform', 'state', 'core']);

const allowed = {
  model: [],
  transform: ['model'],
  state: ['model', 'transform'],
  core: ['model', 'transform', 'state'],
};

const sources = ['apps', 'packages', 'tests', 'scripts'].flatMap((root) =>
  readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(
      (file) => /\.(?:ts|tsx|js|mjs)$/.test(file) && !/(?:^|\/)(?:dist|node_modules)\//.test(file),
    )
    .map((file) => `${root}/${file}`),
);

let checked = 0;

for (const file of sources) {
  const layer = file.startsWith('packages/') ? file.split('/')[1] : null;
  const headless = layers.has(layer) && !file.includes('/__tests__/');

  for (const specifier of dependencies(file, readFileSync(file, 'utf8'))) {
    const target = specifier.startsWith('.')
      ? path.normalize(path.join(path.dirname(file), specifier))
      : /^\/(?:src|packages)\//.test(specifier)
        ? specifier.slice(1)
        : specifier.replace(/^\/@id\//, '');

    const targetLayer = target.startsWith('packages/')
      ? target.split('/')[1]
      : target.startsWith('@gprose/')
        ? target.split('/')[1]
        : null;

    assert.ok(!/^src\/editor(?:\/|$)/.test(target), `${file}: removed editor barrel: ${specifier}`);

    if (headless) {
      if (!specifier.startsWith('.')) {
        const manifest = JSON.parse(readFileSync(`packages/${layer}/package.json`, 'utf8'));
        assert.ok(
          Object.hasOwn(manifest.dependencies, specifier),
          `${file}: undeclared dependency ${specifier}`,
        );
      }

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
        target === `@gprose/${targetLayer}`,
        `${file}: use the ${targetLayer} public entry point, not ${specifier}`,
      );
    }
  }

  if (headless) checked++;
}

for (const fixture of [
  'apps/demo/src/editor-extension-checks.ts',
  'apps/demo/src/editor-container-checks.ts',
  'apps/demo/src/editor-selection-checks.ts',
  'packages/extension-table/src/selection.ts',
]) {
  for (const specifier of dependencies(fixture, readFileSync(fixture, 'utf8'))) {
    assert.ok(
      /^@gprose\/(?:model|transform|state|extension-document|extension-table|extension-editing)$/.test(
        specifier,
      ) ||
        specifier === '@gprose/view' ||
        // Attribute validators are consumer-owned Standard Schema implementations.
        specifier === 'zod',
      `${fixture}: independent fixture bypasses public entry points: ${specifier}`,
    );
  }
}

console.log(
  `Checked ${checked} headless modules and public imports across ${sources.length} files`,
);
