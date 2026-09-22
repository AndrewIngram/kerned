import { spawnSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';

const result = spawnSync(
  'cargo',
  [
    'build',
    '--manifest-path',
    'native-owned/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
  ],
  { stdio: 'inherit' },
);

if (result.status !== 0) process.exit(result.status ?? 1);

await mkdir('apps/demo/public/engines', { recursive: true });

await copyFile(
  'native-owned/target/wasm32-unknown-unknown/release/gprose_owned_shaper.wasm',
  'apps/demo/public/engines/owned.wasm',
);
