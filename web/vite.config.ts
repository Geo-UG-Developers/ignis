import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// En GitHub Pages la app vive en /ignis/. Dos páginas: la app ciudadana y el panel.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/ignis/',
  build: { rollupOptions: { input: { app: resolve(__dirname, 'index.html'), panel: resolve(__dirname, 'panel.html') } } },
});
