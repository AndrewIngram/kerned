import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { chromium, firefox, webkit } from 'playwright';
import { build, preview } from 'vite';

const directory = mkdtempSync(path.join(tmpdir(), 'gprose-consumers-'));

const resolvedPackages = new Set();

try {
  await build({
    configFile: false,
    logLevel: 'warn',
    plugins: [
      react({ compiler: true }),
      {
        name: 'require-built-package-exports',
        enforce: 'pre',
        async resolveId(source, importer) {
          if (!source.startsWith('@gprose/')) return null;
          const resolved = await this.resolve(source, importer, { skipSelf: true });
          assert.ok(resolved?.id.includes('/dist/'), `Consumer resolved source: ${source}`);
          resolvedPackages.add(source);

          return resolved;
        },
      },
    ],
    build: {
      outDir: directory,
      emptyOutDir: true,
      target: 'es2022',
      rollupOptions: {
        input: [
          'tests/consumers/vanilla.html',
          'tests/consumers/react.html',
          'tests/consumers/table.html',
          'tests/consumers/starter.html',
        ],
      },
    },
  });
  assert.deepEqual(
    [...resolvedPackages].toSorted((a, b) => a.localeCompare(b)),
    [
      '@gprose/core',
      '@gprose/extension-comments',
      '@gprose/extension-comments/browser',
      '@gprose/extension-document',
      '@gprose/extension-document/browser',
      '@gprose/extension-editing',
      '@gprose/extension-editing/browser',
      '@gprose/extension-history',
      '@gprose/extension-search',
      '@gprose/extension-table',
      '@gprose/extension-table/browser',
      '@gprose/model',
      '@gprose/react',
      '@gprose/starter-kit/browser',
      '@gprose/state',
      '@gprose/transform',
      '@gprose/view',
      '@gprose/view/text',
    ],
  );

  const server = await preview({
    configFile: false,
    build: { outDir: directory },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  });

  try {
    const url = server.resolvedUrls.local[0];

    for (const [name, launcher] of Object.entries({ chromium, firefox, webkit })) {
      const browser = await launcher.launch();

      try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(url + 'tests/consumers/vanilla.html');
        await page.waitForSelector('#editor[data-ready="ready"]');
        await page.waitForSelector('[data-comment-hit="opening"]');
        await page.waitForFunction(() => {
          const canvas = document.querySelector('canvas');

          const pixels = canvas
            ?.getContext('2d')
            ?.getImageData(0, 0, canvas.width, canvas.height).data;

          if (!pixels) return false;

          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i] === 153 && pixels[i + 1] === 51 && pixels[i + 2] === 102) return true;

          return false;
        });
        await page.keyboard.insertText(' typed');
        await page.waitForFunction(
          () => document.querySelector('output').value === 'Vanilla ready typed',
        );
        assert.equal(await page.locator('canvas').count(), 1);
        await page.getByRole('button', { name: 'Destroy', exact: true }).click();
        await page.waitForSelector('#editor[data-ready="destroyed"]');
        assert.equal(await page.locator('canvas').count(), 0);

        await page.goto(url + 'tests/consumers/table.html');
        await page.waitForSelector('#editor[data-ready="ready"]');
        await page.locator('.table-block textarea').press('End');
        await page.keyboard.insertText('!');
        await page.waitForFunction(() => document.querySelector('output').value === 'Native!');
        await page.getByRole('button', { name: 'Add row', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.table-block tr').length === 2);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.table-block tr').length === 1);
        await page.getByRole('button', { name: 'Select cell 1, 1', exact: true }).click();
        await page.keyboard.press('Backspace');
        await page.waitForFunction(() => document.querySelector('output').value === '');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('output').value === 'Native!');
        await page.getByRole('button', { name: 'Destroy', exact: true }).click();
        await page.waitForSelector('#editor[data-ready="destroyed"]');
        assert.equal(await page.locator('.table-block').count(), 0);

        await page.goto(url + 'tests/consumers/starter.html');
        await page.waitForSelector('#editor[data-ready="ready"]');
        await page.keyboard.insertText(' typed');
        await page.waitForFunction(
          () => document.querySelector('output').value === '<p>Starter typed</p>',
        );
        await page.getByRole('button', { name: 'Quote', exact: true }).click();
        await page.waitForFunction(
          () =>
            document.querySelector('output').value ===
            '<blockquote><p>Starter typed</p></blockquote>',
        );
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.waitForFunction(
          () => document.querySelector('output').value === '<p>Starter typed</p>',
        );
        await page.getByRole('button', { name: 'Destroy', exact: true }).click();
        await page.waitForSelector('#editor[data-ready="destroyed"]');
        assert.equal(await page.locator('canvas').count(), 0);

        await page.goto(url + 'tests/consumers/react.html');
        await page.waitForSelector('body[data-ready="ready"]');
        await page.getByRole('button', { name: 'Custom node: 0', exact: true }).click();
        assert.equal(
          await page.getByRole('button', { name: 'Custom node: 1', exact: true }).count(),
          1,
        );
        await page.getByRole('button', { name: 'Append', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('output').value === 'React!');
        await page.getByRole('button', { name: 'Destroy', exact: true }).click();
        await page.waitForSelector('body[data-ready="destroyed"]');
        assert.equal(await page.locator('canvas').count(), 0);
        assert.deepEqual(errors, []);
        console.log(
          `${name}: built vanilla, standalone table, starter-kit and React consumers passed`,
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
