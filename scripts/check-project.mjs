import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

const sourceFiles = readdirSync('src', { recursive: true })
  .filter((file) => !file.split(path.sep).includes('__tests__'))
  .filter((file) => /\.(ts|tsx|css)$/.test(file))
  .map((file) => path.join('src', file));

const reachable = new Set();

function visit(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  const source = readFileSync(file, 'utf8');

  for (const { fileName: specifier } of ts.preProcessFile(source, true, true).importedFiles) {
    if (!specifier.startsWith('.')) continue;
    const base = path.join(path.dirname(file), specifier);

    const resolved = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());

    assert.ok(resolved, `${file}: missing import ${specifier}`);
    visit(resolved);
  }
}

for (const entry of ['editor.html', 'extensions.html']) {
  const html = readFileSync(entry, 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)];
  assert.ok(scripts.length, `${entry}: missing editor entry point`);

  for (const [, source] of scripts) visit(source.replace(/^\//, ''));
}

// Public headless entry points are supported even when the demo does not import every export.
for (const entry of ['model', 'transform', 'state', 'core']) visit(`src/${entry}/index.ts`);

// Extensions are supported entry points even when the demo does not import them.
for (const file of sourceFiles.filter((file) => file.startsWith('src/extensions/'))) visit(file);

assert.deepEqual(
  sourceFiles.filter((file) => !reachable.has(file)),
  [],
  'Unreachable source files',
);

const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));

for (const command of Object.values(scripts)) {
  for (const [, file] of command.matchAll(/\bnode\s+(scripts\/[^\s]+)/g)) {
    assert.ok(existsSync(file), `Missing package script: ${file}`);
  }
}

const docs = [
  'README.md',
  ...readdirSync('docs')
    .filter((file) => file.endsWith('.md'))
    .map((file) => `docs/${file}`),
];

for (const file of docs) {
  for (const [, target] of readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(?:[a-z]+:|#)/i.test(target)) continue;
    const destination = path.resolve(path.dirname(file), target.split('#')[0]);
    assert.ok(existsSync(destination), `${file}: broken link ${target}`);
  }
}

console.log(
  `Checked ${reachable.size} reachable source files, package scripts and ${docs.length} documents`,
);
