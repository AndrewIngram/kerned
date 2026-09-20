import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: ['index.html', 'editor.html', 'hybrid-editor.html'],
    },
  },
});
