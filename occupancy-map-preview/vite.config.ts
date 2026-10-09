import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { jsonDocumentApi, jsonFileApi, validateMapStyle } from './server/jsonFileApi';

const dataFile = (name: string) => fileURLToPath(new URL(`./data/${name}`, import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    jsonFileApi({
      route: '/api/occupancy',
      generated: dataFile('generated.json'),
      overrides: dataFile('overrides.json'),
    }),
    jsonDocumentApi({ route: '/api/map-style', file: dataFile('map-style.json'), validate: validateMapStyle }),
  ],
  optimizeDeps: { exclude: ['maplibre-gl', '@maplibre/maplibre-gl-leaflet'] },
  server: {
    // Saving the data files (or re-running the pipeline) must not trigger a page reload.
    watch: { ignored: ['**/data/**'] },
  },
});
