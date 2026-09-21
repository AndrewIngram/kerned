import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const groups = [
  'editor-browser',
  'editor-react',
  'editor-canvas',
  'extensions/starter-kit',
  'demo/app',
];

// Traverse syntax, not just top-level import declarations: a barrel or lazy
// import must not provide a back door through the same ownership boundary.
function dependencies(file, code) {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const result = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      assert.ok(
        argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)),
        `${file}: dynamic import must have a statically checkable target`,
      );
      result.push(argument.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(source);

  return result;
}

assert.deepEqual(
  dependencies(
    'fixture.ts',
    "import type {X} from './one'; export {Y} from './two'; async function load(){return import('./three');}",
  ),
  ['./one', './two', './three'],
);

assert.throws(() => dependencies('fixture.ts', 'import(variable)'), /statically checkable/);

let checked = 0;

for (const group of groups) {
  for (const name of readdirSync(`src/${group}`, { recursive: true })) {
    if (!/\.tsx?$/.test(name)) continue;
    const file = `src/${group}/${name}`;

    for (const specifier of dependencies(file, readFileSync(file, 'utf8'))) {
      const target = specifier.startsWith('.')
        ? path.normalize(path.join(path.dirname(file), specifier))
        : specifier;

      if (group !== 'demo/app') {
        assert.ok(
          !target.startsWith('src/demo/'),
          `${file} depends on application code: ${specifier}`,
        );
        assert.ok(
          !/editor-(samples|stream)/.test(target),
          `${file} depends on demo loading: ${specifier}`,
        );
        assert.ok(!target.endsWith('.css'), `${file} imports demo styling: ${specifier}`);
      }

      if (['editor-browser', 'editor-react', 'editor-canvas'].includes(group)) {
        assert.ok(
          !target.startsWith('src/extensions/'),
          `${file} depends on a specific schema: ${specifier}`,
        );
      }

      if(file==='src/extensions/starter-kit/actions.ts'){
        assert.ok(!/src\/editor-(browser|react|canvas)/.test(target),`${file} depends on a view adapter: ${specifier}`);
      }

      if (group === 'editor-browser') {
        assert.ok(
          !['react', 'react-dom', 'canvaskit-wasm'].some(
            (module) => target === module || target.startsWith(module + '/'),
          ),
          `${file} couples native input to a renderer: ${specifier}`,
        );
      }

      if (/checks$/.test(target)) {
        assert.equal(
          file,
          'src/demo/app/use-diagnostics.ts',
          `${file} imports a benchmark/test fixture`,
        );
      }
    }

    checked++;
  }
}

for (const html of ['editor.html', 'extensions.html']) {
  assert.match(
    readFileSync(html, 'utf8'),
    /src="\/src\/demo\/app\/main\.tsx"/,
    `${html} must mount the React app`,
  );
}

console.log(`Checked ownership boundaries across ${checked} app, adapter and starter-kit modules`);
