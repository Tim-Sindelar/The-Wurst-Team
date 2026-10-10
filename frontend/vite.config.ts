import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // As in occupancy-map-preview: the campus map's MapLibre isn't pre-bundled.
  optimizeDeps: { exclude: ['maplibre-gl', '@maplibre/maplibre-gl-leaflet'] },
  server: {
    port: 5173,
    strictPort: true,
    // FastAPI, including the campus map under /api/v1/map.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
});
