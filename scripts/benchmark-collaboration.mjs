import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

import { createServer, defaultServerConditions } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  ssr: {
    resolve: { conditions: [...defaultServerConditions, 'kerned-source'] },
    noExternal: [/^@kerned\//],
  },
});

try {
  const { measureCollaboration } = await server.ssrLoadModule(
    '/tests/experiments/collaboration/measure.ts',
  );

  measureCollaboration(10);
  const rows = [];

  for (let trial = 0; trial < 3; trial++)
    for (const edits of [100, 1000]) rows.push({ trial, ...measureCollaboration(edits) });

  const report = {
    recordedAt: new Date().toISOString(),
    cpu: os.cpus()[0]?.model,
    node: process.version,
    methodology:
      'Three serial trials, one 1024-code-unit block, fixed-size replacement, immediately delivered and acknowledged. Authority: proposal + server validation + both client deliveries. Automerge: local change + one peer delivery + whole-text model projection. No network, rendering, presence, startup or save time in timings. Authority wire bytes count three JSON messages; Automerge counts one raw binary change, without envelope. Saved sizes are DIFFERENT artifacts: authority positions only versus Automerge full document/history. These unoptimized adapters do NOT isolate algorithm, serialization or WASM cost, and do not measure heap.',
    rows,
  };

  const directory = 'artifacts/collaboration-comparison';
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/measurements.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await server.close();
}
