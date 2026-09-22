import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

// The source-to-package moves are explicit so reviewers can audit ownership.
// Rerunning after a move verifies the destination rather than recreating old paths.
export const packageMoves = ['model', 'transform', 'state', 'core'].map((name) => ({
  from: `src/${name}`,
  to: `packages/${name}/src`,
  name: `@gprose/${name}`,
}));

const apply = process.argv.includes('--apply');

const active = packageMoves.filter((move) => existsSync(move.from));

for (const move of packageMoves)
  assert.ok(
    existsSync(move.from) || existsSync(move.to),
    `Missing source and destination: ${move.from}`,
  );

const files = ['src', 'packages', 'tests', 'scripts'].flatMap((root) =>
  existsSync(root)
    ? readdirSync(root, { recursive: true })
        .filter(
          (name) =>
            /\.(?:ts|tsx|js|mjs|css)$/.test(name) && !/(?:^|\/)(?:dist|node_modules)\//.test(name),
        )
        .map((name) => `${root}/${name}`)
    : [],
);

function moved(file) {
  const move = active.find((entry) => file.startsWith(`${entry.from}/`));

  return move ? move.to + file.slice(move.from.length) : file;
}

function resolve(file) {
  return [
    file,
    file.replace(/\.js$/, '.ts'),
    file.replace(/\.js$/, '.tsx'),
    `${file}.ts`,
    `${file}.tsx`,
    `${file}.js`,
    `${file}/index.ts`,
    `${file}/index.tsx`,
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function specifier(file, value, moduleImport) {
  const absolute = value.startsWith('/src/');

  if (!absolute && (!moduleImport || !value.startsWith('.'))) return value;

  const target = resolve(
    absolute ? value.slice(1) : path.normalize(path.join(path.dirname(file), value)),
  );

  if (!target) return value;

  const destination = moved(target),
    current = moved(file);

  const owner = packageMoves.find((entry) => destination.startsWith(`${entry.to}/`));
  const sameOwner = owner && current.startsWith(`${owner.to}/`);

  if (owner && !sameOwner && destination === `${owner.to}/index.ts`)
    return absolute ? `/@id/${owner.name}` : owner.name;

  if (absolute) return destination === target ? value : `/${destination}`;

  if (destination === target && current === file) return value;
  let relative = path.relative(path.dirname(current), destination);

  if (!relative.startsWith('.')) relative = `./${relative}`;

  return relative.replace(/\.tsx?$/, '.js');
}

const edits = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const replacements = [];

  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;

      const moduleImport =
        ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
          parent.moduleSpecifier === node) ||
        (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent));

      const next = specifier(file, node.text, moduleImport);

      if (next !== node.text)
        replacements.push({
          start: node.getStart(parsed),
          end: node.getEnd(),
          value: JSON.stringify(next),
        });
    }

    ts.forEachChild(node, visit);
  }

  visit(parsed);
  let result = source;

  for (const edit of replacements.toReversed())
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);

  if (result !== source || moved(file) !== file)
    edits.push({ file, destination: moved(file), source: result });
}

console.log(JSON.stringify({ moves: active, editedFiles: edits.length, apply }, null, 2));

if (apply) {
  for (const move of active) {
    assert.ok(!existsSync(move.to), `Destination already exists: ${move.to}`);
    mkdirSync(path.dirname(move.to), { recursive: true });
    renameSync(move.from, move.to);
  }

  for (const edit of edits) writeFileSync(edit.destination, edit.source);
}
