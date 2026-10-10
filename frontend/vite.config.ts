import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { datasetsApi } from './server/datasetsApi';
import { ethRoomsApi } from './server/ethRoomsApi';
import {
  jsonDocumentApi,
  jsonFileApi,
  validateMapStyle,
} from './server/jsonFileApi';
import { staticDir } from './server/staticDir';
import { validateNavigation } from './src/campus-map/domain/navigation';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const mapData = (name: string) => here(`./map-data/${name}`);
// Floor plans built by scraper/extract_floors.py (not in git).
const floorsDir = process.env.MAP_FLOORS_DIR
  ? path.resolve(process.env.MAP_FLOORS_DIR)
  : here('../occupancy-map-preview/public/floors');

/* The campus map's backend, copied from occupancy-map-preview: Vite
   middleware that serves the map configuration in map-data/, the floor plans,
   the ETH room bookings and the campus datasets. It answers its own /api
   routes before the proxy; everything else under /api goes to FastAPI. */
const campusMapApi = [
  jsonFileApi({
    route: '/api/occupancy',
    generated: mapData('generated.json'),
    overrides: mapData('overrides.json'),
  }),
  jsonDocumentApi({
    route: '/api/map-style',
    file: mapData('map-style.json'),
    validate: validateMapStyle,
  }),
  jsonDocumentApi({
    route: '/api/navigation',
    file: mapData('navigation.json'),
    validate: validateNavigation,
  }),
  // Campus datasets (../datasets/<id>/fetch.py), fetched on demand and cached per their ttl.
  datasetsApi({
    dir: here('../datasets'),
    cacheDir: mapData('cache/datasets'),
  }),
  // Live room bookings via eth_room_dashboard.py (started on demand unless ETH_ROOMS_AUTOSTART=0).
  ethRoomsApi({
    target: process.env.ETH_ROOMS_URL ?? 'http://127.0.0.1:8765',
    floorsDir,
    script: here('../eth_room_dashboard.py'),
    snapshotFile: mapData('cache/eth-rooms.json'),
    autostart: process.env.ETH_ROOMS_AUTOSTART !== '0',
  }),
  staticDir({ route: '/floors', dir: floorsDir }),
];

export default defineConfig({
  plugins: [react(), tailwindcss(), ...campusMapApi],
  optimizeDeps: { exclude: ['maplibre-gl', '@maplibre/maplibre-gl-leaflet'] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8000' },
    // Writing the map caches must not reload the page.
    watch: { ignored: ['**/map-data/**'] },
  },
});
