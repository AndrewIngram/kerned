import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));

const packages = readdirSync(path.join(root, 'packages')).map((directory) => {
  const location = path.join(root, 'packages', directory);

  return {
    location,
    manifest: JSON.parse(readFileSync(path.join(location, 'package.json'), 'utf8')),
  };
});

const pending = new Map(packages.map((entry) => [entry.manifest.name, entry]));

while (pending.size) {
  const next = [...pending.values()].find(({ manifest }) =>
    Object.keys(manifest.dependencies ?? {}).every((name) => !pending.has(name)),
  );

  assert.ok(next, 'Workspace package dependencies contain a cycle');
  const { location, manifest } = next;

  const config = ts.readConfigFile(path.join(location, 'tsconfig.build.json'), (file) =>
    ts.sys.readFile(file),
  );

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, location);
  const outDir = path.join(location, 'dist');
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });

  const diagnostics = [
    ...(config.error ? [config.error] : []),
    ...parsed.errors,
    ...ts.getPreEmitDiagnostics(program),
  ];

  if (diagnostics.length) {
    process.stderr.write(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (name) => name,
        getNewLine: () => '\n',
      }),
    );
    process.exitCode = 1;
    break;
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const emitted = program.emit();
  assert.equal(emitted.emitSkipped, false, `Emit skipped for ${manifest.name}`);
  assert.deepEqual(emitted.diagnostics, [], `Emit diagnostics for ${manifest.name}`);

  for (const file of readdirSync(path.join(location, 'src'), { recursive: true })) {
    if (!file.endsWith('.css')) continue;
    const destination = path.join(outDir, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(path.join(location, 'src', file)));
  }

  pending.delete(manifest.name);
  console.log(`Built ${manifest.name}`);
}
