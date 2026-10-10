import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

// Serves the files of a directory outside the project under `route`, for the
// dev and preview servers. The campus map's floor plans live in
// occupancy-map-preview/public/floors, where scraper/extract_floors.py writes them.

const TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

export function staticDir({
  route,
  dir,
}: {
  route: string;
  dir: string;
}): Plugin {
  const root = path.resolve(dir);
  const handler = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = (req.url ?? '').split('?')[0];
    if (
      !url.startsWith(`${route}/`) ||
      (req.method !== 'GET' && req.method !== 'HEAD')
    )
      return next();
    const file = path.resolve(
      root,
      `.${decodeURIComponent(url.slice(route.length))}`,
    );
    if (!file.startsWith(root + path.sep)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    try {
      const body = await fs.readFile(file);
      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        TYPES[path.extname(file)] ?? 'application/octet-stream',
      );
      res.setHeader('Cache-Control', 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.statusCode = 404;
      res.end(`${url} not found`);
    }
  };
  return {
    name: `static-dir:${route}`,
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
