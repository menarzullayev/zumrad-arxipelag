import { defineConfig } from 'vite';

// Relative base so the build works under any sub-path (GitHub Pages: /zumrad-arxipelag/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
});
