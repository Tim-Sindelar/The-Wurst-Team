import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Floor plans are built once by scraper/extract_floors.py into the occupancy map's public dir;
// serve them from there instead of keeping a second copy.
const floorsDir = resolve(
  process.env.FLOORS_DIR ?? fileURLToPath(new URL('../occupancy-map-preview/public/floors', import.meta.url)),
);

function sharedFloors(): Plugin {
  let outDir = 'dist';
  return {
    name: 'shared-floors',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/floors', (req, res, next) => {
        const path = normalize(join(floorsDir, decodeURIComponent((req.url ?? '/').split('?')[0])));
        if (!path.startsWith(floorsDir) || !existsSync(path) || !statSync(path).isFile()) return next();
        res.setHeader('Content-Type', 'application/json');
        createReadStream(path).pipe(res);
      });
    },
    closeBundle() {
      if (existsSync(floorsDir)) cpSync(floorsDir, join(outDir, 'floors'), { recursive: true });
    },
  };
}

// HTTPS (self-signed) because camera, Web Bluetooth and motion sensors need a secure context
// when the phone opens the dev server over the LAN. Set PLAIN_HTTP=1 for local headless testing.
export default defineConfig({
  // BASE_PATH=/ar/ when served under a path prefix (the VM's router). Data is fetched relative to the page.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), sharedFloors(), ...(process.env.PLAIN_HTTP ? [] : [basicSsl()])],
  // Own port: 5173 is the occupancy map's, and silently moving to the next free port
  // leaves the phone pointing at the wrong server.
  // The visual positioning server (../vps) answers vps/localize; the model is a static file in public/vps.
  server: {
    host: true,
    port: 5443,
    strictPort: true,
    proxy: {
      '^/vps/(localize|health|debug/)': { target: process.env.VPS_URL ?? 'http://127.0.0.1:8090', rewrite: (p) => p.replace(/^\/vps/, '') },
    },
  },
  preview: { host: true, port: 5443, strictPort: true },
  // The SuperPoint worker imports onnxruntime-web dynamically: needs ES module workers.
  worker: { format: 'es' },
  test: { environment: 'node' },
});
