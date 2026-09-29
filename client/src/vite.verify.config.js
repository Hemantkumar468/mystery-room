/* Scratch config for browser verification against the LOCAL database.
   Delete when done — see the note in PropertyCaptureModal's verification. */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(process.cwd()),
  plugins: [react()],
  optimizeDeps: { exclude: ['maplibre-gl'] },
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://localhost:5062/api/v1') },
  server: { port: 5176, strictPort: true },
});
