import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { jsonDocumentApi, jsonFileApi, validateMapStyle } from './server/jsonFileApi';
import { validateNavigation } from './src/domain/navigation';
import { ethRoomsApi } from './server/ethRoomsApi';
import { datasetsApi } from './server/datasetsApi';

const dataFile = (name: string) => fileURLToPath(new URL(`./data/${name}`, import.meta.url));
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    jsonFileApi({
      route: '/api/occupancy',
      generated: dataFile('generated.json'),
      overrides: dataFile('overrides.json'),
    }),
    jsonDocumentApi({ route: '/api/map-style', file: dataFile('map-style.json'), validate: validateMapStyle }),
    jsonDocumentApi({ route: '/api/navigation', file: dataFile('navigation.json'), validate: validateNavigation }),
    // Campus datasets (../datasets/<id>/fetch.py), fetched on demand and cached per their ttl.
    datasetsApi({ dir: here('../datasets'), cacheDir: dataFile('cache/datasets') }),
    // Live room bookings via eth_room_dashboard.py (started on demand unless ETH_ROOMS_AUTOSTART=0).
    ethRoomsApi({
      target: process.env.ETH_ROOMS_URL ?? 'http://127.0.0.1:8765',
      floorsDir: here('./public/floors'),
      script: here('../eth_room_dashboard.py'),
      snapshotFile: dataFile('cache/eth-rooms.json'),
      autostart: process.env.ETH_ROOMS_AUTOSTART !== '0',
    }),
  ],
  optimizeDeps: { exclude: ['maplibre-gl', '@maplibre/maplibre-gl-leaflet'] },
  server: {
    // Saving the data files (or re-running the pipeline) must not trigger a page reload.
    watch: { ignored: ['**/data/**'] },
  },
});
