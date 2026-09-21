import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react({ compiler: true })],
  // Dynamic fixture imports must be optimized before any browser starts its tests.
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'zod', 'canvaskit-wasm'] },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/__tests__/**/*.test.{js,ts,tsx}', 'tests/**/*.test.{js,ts,tsx}'],
          exclude: ['**/*.browser.test.{js,ts,tsx}', 'tests/e2e/**'],
        },
      },
      {
        test: {
          name: 'browser',
          include: [
            'src/**/__tests__/**/*.browser.test.{js,ts,tsx}',
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
