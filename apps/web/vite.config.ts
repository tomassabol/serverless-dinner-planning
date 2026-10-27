import { readFileSync, existsSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm dev-config` writes public/config.json (Cognito ids) and .dev-api (API Gateway stage URL).
const apiUrl = existsSync('.dev-api') ? readFileSync('.dev-api', 'utf8').trim() : undefined;

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    // In production CloudFront serves /api/* from API Gateway; locally Vite does the same.
    proxy: apiUrl
      ? { '/api': { target: apiUrl, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } }
      : undefined,
  },
});
