import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
export default defineConfig({
  base: './',
  plugins: [cesium()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:' + (process.env.PORT || 8790) } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000, target: 'es2022' },
});
