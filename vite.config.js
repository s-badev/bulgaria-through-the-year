import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function gitHash() {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'nogit'; }
}

export default defineConfig({
  base: './',
  define: {
    __APP_COMMIT__: JSON.stringify(gitHash()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
