import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { jsonFileApi } from './server/jsonFileApi';

const dataFile = fileURLToPath(new URL('./data/occupancy.json', import.meta.url));

export default defineConfig({
  plugins: [react(), jsonFileApi({ route: '/api/occupancy', file: dataFile })],
  server: {
    // Saving the JSON file must not trigger a page reload.
    watch: { ignored: ['**/data/**'] },
  },
});
