import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ruta base. Por defecto "/" (workers.dev). Con dominio: VITE_BASE_PATH=/tools/markdown/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    outDir: 'dist',
  },
});
