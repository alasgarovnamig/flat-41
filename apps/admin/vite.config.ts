import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // @evtap/shared is a linked workspace package that ships CJS + ESM: pre-bundle it so dev and build agree.
  optimizeDeps: { include: ['@evtap/shared'] },
  build: { chunkSizeWarningLimit: 1500 },
  server: { port: 3001, strictPort: true },
  preview: { port: 3001 },
});
