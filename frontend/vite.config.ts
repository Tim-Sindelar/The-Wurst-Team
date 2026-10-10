import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { resolveSocialMode } from './src/domain/socialMode.ts';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const social = resolveSocialMode(
    env.VITE_SOCIAL_ENABLED,
    env.VITE_SOCIAL_DEMO_ENABLED,
  );
  return {
    base: process.env.VITE_APP_BASE_PATH ?? '/',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'social-build-mode',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'social-config.json',
            source: JSON.stringify(social),
          });
        },
      },
    ],
    // As in occupancy-map-preview: the campus map's MapLibre isn't pre-bundled.
    optimizeDeps: { exclude: ['maplibre-gl', '@maplibre/maplibre-gl-leaflet'] },
    server: {
      port: 5173,
      strictPort: true,
      // FastAPI, including the campus map under /api/v1/map.
      proxy: {
        '/api': env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
      },
    },
  };
});
