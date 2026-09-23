import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [from, to] = process.argv.slice(2);

if (!from || !to || !/^[a-z][a-z0-9-]*$/.test(from) || !/^[a-z][a-z0-9-]*$/.test(to)) {
  throw new Error('Usage: node scripts/rename-brand.mjs <old-brand> <new-brand>');
}

const capitalize = (value) => value[0].toUpperCase() + value.slice(1);

const replacements = [
  [from.toUpperCase(), to.toUpperCase()],
  [capitalize(from), capitalize(to)],
  [from, to],
];

const trackedPaths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

for (const relativePath of trackedPaths) {
  const absolutePath = path.resolve(relativePath);

  if (!statSync(absolutePath).isFile()) continue;

  const original = readFileSync(absolutePath);
  const source = original.toString('utf8');
  let updated = source;

  for (const [oldValue, newValue] of replacements) {
    updated = updated.replaceAll(oldValue, newValue);
  }

  if (updated !== source) writeFileSync(absolutePath, updated);

  const renamedPath = relativePath.replace(new RegExp(from, 'gi'), to);

  if (renamedPath !== relativePath) renameSync(absolutePath, path.resolve(renamedPath));
}
