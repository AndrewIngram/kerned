import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ts from 'typescript';

const directory = mkdtempSync(path.join(tmpdir(), 'kerned-declarations-'));

try {
  const config = ts.readConfigFile('tsconfig.json', (file) => ts.sys.readFile(file));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: {
      ...parsed.options,
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      rootDir: process.cwd(),
      outDir: directory,
    },
  });

  const emitted = program.emit();

  const diagnostics = [
    ...(config.error ? [config.error] : []),
    ...parsed.errors,
    ...ts.getPreEmitDiagnostics(program),
    ...emitted.diagnostics,
  ];

  if (diagnostics.length) {
    process.stderr.write(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => process.cwd(),
        getCanonicalFileName: (name) => name,
        getNewLine: () => '\n',
      }),
    );
    process.exitCode = 1;
  } else console.log('TypeScript declarations emitted successfully.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
