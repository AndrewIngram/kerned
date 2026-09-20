import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const files = [
  "NotoSans-Regular.ttf",
  "NotoSans-Bold.ttf",
  "NotoSans-Italic.ttf",
  "NotoSans-BoldItalic.ttf",
  "NotoSansArabic-Regular.ttf",
  "NotoSansHebrew-Regular.ttf",
  "NotoSansDevanagari-Regular.ttf",
  "NotoSansCJKjp-Regular.otf",
];
const source = await readFile("src/model.ts", "utf8");
const chars = [
  ...new Set([...source].map((c) => c.codePointAt(0)).filter((c) => c > 127)),
];
const unicodes = [
  "U+0020-007E",
  "U+00A0-00FF",
  "U+0300-036F",
  ...chars.map((c) => `U+${c.toString(16).toUpperCase()}`),
].join(",");
await mkdir("public/glyph-spike", { recursive: true });
const records = [];
for (const file of files) {
  const output = `public/glyph-spike/${file.replace(/\.(ttf|otf)$/, "")}.glb`;
  const start = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/@pmndrs/glyph/bin/glyph.js",
      "bake",
      "--input",
      `public/fonts/${file}`,
      "--output",
      output,
      "--unicodes",
      unicodes,
      "--msdf",
      "--yes",
      ...(process.argv.includes("--force") ? ["--force"] : []),
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    records.push({
      file,
      status: "failed",
      preparationMs: performance.now() - start,
      error: result.stderr,
    });
    console.error(`Bake failed: ${file}`);
    continue;
  }
  console.log(result.stdout.trim());
  records.push({
    file,
    status: "ready",
    output,
    preparationMs: performance.now() - start,
    cached: result.stdout.includes("up to date"),
    bytes: (await stat(output)).size,
  });
}
await writeFile(
  "public/glyph-spike/manifest.json",
  JSON.stringify(
    {
      package: "@pmndrs/glyph@0.1.0",
      technique: "MSDF",
      coverage:
        "ASCII, Latin-1, combining marks, and characters present in src/model.ts; no color emoji",
      records,
    },
    null,
    2,
  ),
);
