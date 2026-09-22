import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  publicDir: 'apps/demo/public',
  resolve: { conditions: [...defaultClientConditions, 'gprose-source'] },
  ssr: {
    resolve: { conditions: [...defaultServerConditions, 'gprose-source'] },
    noExternal: [/^@gprose\//],
  },
  plugins: [react({ compiler: true })],
  // Dynamic fixture imports must be optimized before any browser starts its tests.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-dom/server',
      'zod',
      'canvaskit-wasm',
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'apps/*/src/**/__tests__/**/*.test.{js,ts,tsx}',
            'packages/*/src/**/__tests__/**/*.test.{js,ts,tsx}',
            'tests/**/*.test.{js,ts,tsx}',
          ],
          exclude: ['**/node_modules/**', '**/*.browser.test.{js,ts,tsx}', 'tests/e2e/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: [
            'apps/*/src/**/__tests__/**/*.browser.test.{js,ts,tsx}',
            'packages/*/src/**/__tests__/**/*.browser.test.{js,ts,tsx}',
            'tests/**/*.browser.test.{js,ts,tsx}',
          ],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [
              { browser: 'chromium', name: 'browser-chromium' },
              { browser: 'firefox', name: 'browser-firefox' },
              { browser: 'webkit', name: 'browser-webkit' },
            ],
          },
        },
      },
    ],
  },
});
