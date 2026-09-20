import { spawnSync } from "node:child_process";
import { mkdir, copyFile } from "node:fs/promises";

const build = spawnSync(
  "cargo",
  [
    "build",
    "--manifest-path",
    "native/Cargo.toml",
    "--target",
    "wasm32-unknown-unknown",
    "--release",
    "--locked",
  ],
  { stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status ?? 1);
await mkdir("public/engines", { recursive: true });
await copyFile(
  "native/target/wasm32-unknown-unknown/release/gprose_parley.wasm",
  "public/engines/parley.wasm",
);
