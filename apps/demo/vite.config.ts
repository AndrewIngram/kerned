import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig(({ mode, command }) => ({
  cacheDir: mode === 'e2e' ? 'node_modules/.vite-e2e' : 'node_modules/.vite',
  resolve: {
    conditions: [...defaultClientConditions, ...(command === 'serve' ? ['gprose-source'] : [])],
  },
  plugins: [react({ compiler: true })],
  build: {
    rollupOptions: {
      input: ['index.html', 'editor.html', 'extensions.html', 'collaboration.html'],
    },
  },
}));
