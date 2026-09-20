import { defineConfig } from 'vite';
export default defineConfig({ build: { outDir: 'dist-owned', rollupOptions: { input: 'owned-layout.html' } } });
