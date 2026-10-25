import { defineConfig } from 'vite';
// En GitHub Pages la app vive en /ignis/.
export default defineConfig({ base: process.env.BASE_PATH ?? '/ignis/' });
