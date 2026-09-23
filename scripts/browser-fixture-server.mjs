import { fileURLToPath } from 'node:url';

import { createServer, defaultClientConditions } from 'vite';

/** Source diagnostics run independently of the demo's application root. */
export async function createBrowserFixtureServer() {
  const root = fileURLToPath(new URL('../', import.meta.url));

  const server = await createServer({
    configFile: false,
    root,
    publicDir: 'apps/demo/public',
    cacheDir: 'node_modules/.vite-fixtures',
    logLevel: 'warn',
    resolve: { conditions: [...defaultClientConditions, 'kerned-source'] },
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });

  await server.listen();

  return {
    url: new URL('tests/fixtures/browser.html', server.resolvedUrls.local[0]).href,
    close: () => server.close(),
  };
}
