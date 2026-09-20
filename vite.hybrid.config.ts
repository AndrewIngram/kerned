import { defineConfig } from 'vite';
export default defineConfig({ build: { outDir: 'dist-hybrid', rollupOptions: { input: ['hybrid-editor.html','editor.html'] } } });
