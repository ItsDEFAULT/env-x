import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative base so the same build works at a domain root, under a sub-path, or from `envx ui`.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@envx/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5291,
  },
});
