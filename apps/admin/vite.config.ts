import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    // Monorepo safety: hoisted libraries (react-router, react-query, recharts…) must use the SAME React copy as the app.
    // Without this, a different React version hoisted at the repo root causes "Invalid hook call" and a blank (black) screen.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  // @evtap/shared is a linked workspace package that ships CJS + ESM: pre-bundle it so dev and build agree.
  optimizeDeps: { include: ['@evtap/shared'] },
  build: { chunkSizeWarningLimit: 1500 },
  server: { port: 3001, strictPort: true },
  preview: { port: 3001 },
});
