import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist-glyph-spike",
    rollupOptions: { input: "glyph-spike.html" },
  },
});
