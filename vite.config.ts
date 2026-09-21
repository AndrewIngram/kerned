import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  cacheDir: mode === 'e2e' ? 'node_modules/.vite-e2e' : 'node_modules/.vite',
  plugins: [react({ compiler: true })],
  build: {
    rollupOptions: {
      input: ['index.html', 'editor.html', 'extensions.html'],
    },
  },
}));
