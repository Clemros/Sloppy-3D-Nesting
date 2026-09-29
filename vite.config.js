import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  worker: { format: 'es' },
  // three.js alone is ~650 kB minified.
  build: { chunkSizeWarningLimit: 1000 },
});
