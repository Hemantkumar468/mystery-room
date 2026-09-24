import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Express backend so the SPA and API share an origin.
// API_PROXY_TARGET (e.g. in a .env.<mode>.local file) points it at another API.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.API_PROXY_TARGET || 'http://localhost:5000',
          changeOrigin: true,
        },
      },
    },
  };
});
