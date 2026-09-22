import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { dependencies } from './import-dependencies.mjs';

assert.deepEqual(
  dependencies(
    'fixture.ts',
    "import type {X} from './one'; export {Y} from './two'; async function load(){return import('./three');} type T = import('./four').Type;",
  ),
  ['./one', './two', './three', './four'],
);

assert.throws(() => dependencies('fixture.ts', 'import(variable)'), /statically checkable/);

const sources = ['apps', 'packages'].flatMap((root) =>
  readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/(?:^|\/)(?:dist|node_modules)\//.test(file))
    .map((file) => `${root}/${file}`),
);

const packages = new Set(readdirSync('packages'));

let checked = 0;

for (const file of sources) {
  const owner = file.startsWith('packages/') ? file.split('/')[1] : null;
  const production = !file.includes('/__tests__/');
  const app = file.startsWith('apps/') ? file.split('/')[1] : null;

  for (const specifier of dependencies(file, readFileSync(file, 'utf8'))) {
    const target = specifier.startsWith('.')
      ? path.normalize(path.join(path.dirname(file), specifier))
      : specifier;

    const targetOwner = target.startsWith('packages/') ? target.split('/')[1] : null;

    // Colocated implementation tests may inspect internals; production callers use exports.
    if (production && packages.has(targetOwner) && targetOwner !== owner)
      assert.fail(`${file} bypasses the ${targetOwner} public interface: ${specifier}`);

    if (production && app && !specifier.startsWith('.')) {
      const manifest = JSON.parse(readFileSync(`apps/${app}/package.json`, 'utf8'));

      const name = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];

      assert.ok(
        Object.hasOwn(manifest.dependencies ?? {}, name) ||
          Object.hasOwn(manifest.devDependencies ?? {}, name),
        `${file}: undeclared application dependency ${specifier}`,
      );
    }

    if (production && packages.has(owner)) {
      assert.ok(
        !target.startsWith('apps/'),
        `${file} depends on application or schema implementation: ${specifier}`,
      );
      assert.ok(
        !/editor-(samples|stream)/.test(target),
        `${file} depends on demo loading: ${specifier}`,
      );

      if (!specifier.startsWith('.')) {
        const manifest = JSON.parse(readFileSync(`packages/${owner}/package.json`, 'utf8'));

        const name = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0];

        assert.ok(
          Object.hasOwn(manifest.dependencies ?? {}, name) ||
            Object.hasOwn(manifest.peerDependencies ?? {}, name),
          `${file}: undeclared dependency ${specifier}`,
        );
      }
    }

    if (production && packages.has(owner)) {
      const directory = `packages/${owner}/src/`;
      assert.ok(
        !target.endsWith('.css') || target.startsWith(directory),
        `${file} imports styles owned by another module: ${specifier}`,
      );
    }

    if (production && owner === 'view') {
      assert.ok(
        !['react', 'react-dom', '@gprose/react'].some(
          (name) => target === name || target.startsWith(name + '/'),
        ),
        `${file} couples the view lifecycle to React: ${specifier}`,
      );
    }

    if (file.startsWith('packages/view/src/browser/')) {
      assert.ok(
        !['react', 'react-dom', 'canvaskit-wasm'].some(
          (name) => target === name || target.startsWith(name + '/'),
        ),
        `${file} couples native input to a renderer: ${specifier}`,
      );
    }

    if (
      ['packages/extension-editing/src/commands.ts', 'packages/starter-kit/src/index.ts'].includes(
        file,
      )
    )
      assert.ok(
        !/^@gprose\/(view|react)(?:\/|$)/.test(target),
        `${file} imports a view adapter: ${specifier}`,
      );

    if (
      [
        'packages/extension-document/src/image-view.ts',
        'packages/extension-table/src/table-view.ts',
      ].includes(file)
    )
      assert.ok(
        !['react', 'react-dom', '@gprose/react'].some(
          (name) => target === name || target.startsWith(name + '/'),
        ),
        `${file} couples view lifecycle to React: ${specifier}`,
      );

    if (production && /checks(?:\.js)?$/.test(target) && target.startsWith('apps/'))
      assert.equal(
        file,
        'apps/demo/src/app/use-diagnostics.ts',
        `${file} imports a benchmark/test fixture`,
      );
  }

  checked++;
}

for (const html of ['apps/demo/editor.html', 'apps/demo/extensions.html'])
  assert.match(
    readFileSync(html, 'utf8'),
    /src="\/src\/app\/main\.tsx"/,
    `${html} must mount the React app`,
  );

console.log(`Checked ownership boundaries across ${checked} source modules`);
