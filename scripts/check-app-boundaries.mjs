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

const sources = ['src', 'packages'].flatMap((root) =>
  readdirSync(root, { recursive: true })
    .filter((file) => /\.tsx?$/.test(file) && !/(?:^|\/)(?:dist|node_modules)\//.test(file))
    .map((file) => `${root}/${file}`),
);

const adapters = new Set(['view', 'react']);

let checked = 0;

for (const file of sources) {
  const owner = file.startsWith('packages/') ? file.split('/')[1] : null;
  const production = !file.includes('/__tests__/');

  for (const specifier of dependencies(file, readFileSync(file, 'utf8'))) {
    const target = specifier.startsWith('.')
      ? path.normalize(path.join(path.dirname(file), specifier))
      : specifier;

    const targetOwner = target.startsWith('packages/') ? target.split('/')[1] : null;

    // Colocated implementation tests may inspect internals; production callers use exports.
    if (production && adapters.has(targetOwner) && targetOwner !== owner)
      assert.fail(`${file} bypasses the ${targetOwner} public interface: ${specifier}`);

    if (production && adapters.has(owner)) {
      assert.ok(
        !target.startsWith('src/'),
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
          Object.hasOwn(manifest.dependencies, name) ||
            Object.hasOwn(manifest.peerDependencies ?? {}, name),
          `${file}: undeclared dependency ${specifier}`,
        );
      }
    }

    if (production && (adapters.has(owner) || file.startsWith('src/extensions/starter-kit/'))) {
      const directory = owner ? `packages/${owner}/src/` : 'src/extensions/starter-kit/';
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
      ['src/extensions/starter-kit/commands.ts', 'src/extensions/starter-kit/index.ts'].includes(
        file,
      )
    )
      assert.ok(
        !/^@gprose\/(view|react)(?:\/|$)/.test(target),
        `${file} imports a view adapter: ${specifier}`,
      );

    if (
      [
        'src/extensions/starter-kit/image-view.ts',
        'src/extensions/starter-kit/table-view.ts',
      ].includes(file)
    )
      assert.ok(
        !['react', 'react-dom', '@gprose/react'].some(
          (name) => target === name || target.startsWith(name + '/'),
        ),
        `${file} couples view lifecycle to React: ${specifier}`,
      );

    if (production && /checks(?:\.js)?$/.test(target) && target.startsWith('src/'))
      assert.equal(
        file,
        'src/demo/app/use-diagnostics.ts',
        `${file} imports a benchmark/test fixture`,
      );
  }

  checked++;
}

for (const html of ['editor.html', 'extensions.html'])
  assert.match(
    readFileSync(html, 'utf8'),
    /src="\/src\/demo\/app\/main\.tsx"/,
    `${html} must mount the React app`,
  );

console.log(`Checked ownership boundaries across ${checked} source modules`);
