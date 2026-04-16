import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const devHost = process.env.VITE_DEV_HOST ?? '127.0.0.1';
const parsedDevPort = Number.parseInt(process.env.VITE_DEV_PORT ?? '5180', 10);
const devPort = Number.isFinite(parsedDevPort) ? parsedDevPort : 5180;
const isBuildWatchMode = process.argv.includes('--watch');

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: devHost,
    port: devPort,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    watch: isBuildWatchMode
      ? {
          exclude: ['dist/**', 'dist-electron/**', '**/vite.config.ts.timestamp-*.mjs']
        }
      : null
  }
});
