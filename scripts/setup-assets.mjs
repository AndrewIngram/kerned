import { createHash } from 'node:crypto';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';

const checksums = JSON.parse(await readFile('public/fonts/checksums.json', 'utf8'));

function verify(name, bytes) {
  const checksum = createHash('sha256').update(bytes).digest('hex');

  if (checksum !== checksums[name]?.sha256)
    throw new Error(
      `${name}: checksum mismatch; review upstream changes before updating the editor.`,
    );
}

await mkdir('public/engines', { recursive: true });

await mkdir('public/fonts', { recursive: true });

await copyFile('node_modules/canvaskit-wasm/bin/canvaskit.wasm', 'public/engines/canvaskit.wasm');

const sources = [
  [
    'NotoSans-Regular.ttf',
    'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf',
  ],
  [
    'NotoSans-Bold.ttf',
    'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf',
  ],
  [
    'NotoSans-Italic.ttf',
    'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Italic.ttf',
  ],
  [
    'NotoSans-BoldItalic.ttf',
    'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-BoldItalic.ttf',
  ],
  [
    'NotoColorEmoji.ttf',
    'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/fonts/NotoColorEmoji.ttf',
  ],
];

for (const [name, url] of sources) {
  const path = `public/fonts/${name}`;

  try {
    const bytes = await readFile(path);
    verify(name, bytes);
    continue;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const response = await fetch(url);

  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  verify(name, bytes);
  await writeFile(path, bytes);
  process.stdout.write(`Downloaded ${name}\n`);
}

for (const [name, url] of [
  ['LICENSE-Noto.txt', 'https://raw.githubusercontent.com/notofonts/noto-fonts/main/LICENSE'],
  [
    'LICENSE-Emoji.txt',
    'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/fonts/LICENSE',
  ],
]) {
  const path = `public/fonts/${name}`;

  try {
    const bytes = await readFile(path);
    verify(name, bytes);
    continue;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const response = await fetch(url);

  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  verify(name, bytes);
  await writeFile(path, bytes);
}
