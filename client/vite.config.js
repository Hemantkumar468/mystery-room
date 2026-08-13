import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Express backend so the SPA and API share an origin.
export default defineConfig({
  plugins: [react()],

  /**
   * MapLibre must NOT go through Vite's dependency pre-bundling.
   *
   * MapLibre GL does its tile and GeoJSON parsing in a Web Worker, which it
   * loads by URL at runtime. Vite's optimizer rewrites the package into
   * `.vite/deps/` and the worker URL no longer resolves:
   *
   *     net::ERR_FAILED .../deps/maplibre-gl-worker.mjs
   *
   * The failure is quiet and extremely misleading. The map still mounts, WebGL
   * still initialises, the canvas is the right size, HTML markers still render
   * — but every source that needs the worker to be parsed (which is every
   * GeoJSON and every tile) silently produces nothing. All you see is the
   * background layer, because that is the only thing drawn without the worker.
   * It looks exactly like a styling bug, and it is not.
   *
   * Excluding the package leaves it as real ESM, worker URL intact.
   */
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  /**
   * Vitest.
   *
   * `environment: 'node'` deliberately — every test here exercises pure
   * functions (reducers, selectors, the data normaliser). None of them touch
   * the DOM, and none of them touch MapLibre, which needs a WebGL context that
   * no headless environment provides anyway. Testing the map itself means a
   * real browser (Playwright); testing the logic behind it does not, and that
   * logic is where the bugs live.
   */
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
