import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolveSocialEnabled } from './src/domain/socialMode.ts';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const social = { enabled: resolveSocialEnabled(env.VITE_SOCIAL_ENABLED) };
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
      serviceWorker(),
    ],
    // As in occupancy-map-preview: the campus map's MapLibre isn't pre-bundled.
    optimizeDeps: { exclude: ['maplibre-gl', '@maplibre/maplibre-gl-leaflet'] },
    server: {
      port: 5173,
      strictPort: true,
      // FastAPI, including the campus map under /api/v1/map and the events stream.
      proxy: {
        '/api': env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
      },
    },
  };
});

/** Emits sw.js from pwa/service-worker.js with this build's id and the files
 *  to cache on install: the page, its entry chunks and styles, the manifest
 *  and the icons. Lazy chunks (the campus map) are cached when first used. */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const shell = new Set(['index.html', 'manifest.webmanifest']);
      const add = (fileName: string) => {
        const chunk = bundle[fileName];
        if (!chunk || shell.has(fileName)) return;
        shell.add(fileName);
        if (chunk.type !== 'chunk') return;
        chunk.imports.forEach(add);
        chunk.viteMetadata?.importedCss.forEach(add);
      };
      for (const chunk of Object.values(bundle))
        if (chunk.type === 'chunk' && chunk.isEntry) add(chunk.fileName);
      for (const icon of ['icons/icon-192.png', 'icons/icon-512.png'])
        shell.add(icon);

      const id = createHash('sha256')
        .update(Object.keys(bundle).sort().join('\n'))
        .digest('hex')
        .slice(0, 12);
      const source = readFileSync('pwa/service-worker.js', 'utf8').replace(
        'self.__BUILD__',
        JSON.stringify({ id, precache: [...shell] }),
      );
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
