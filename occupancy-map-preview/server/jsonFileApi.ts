import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { validateOccupancyData } from '../src/domain/validate';

// Stand-in backend for the preview: serves one JSON document over
// GET/PUT so the frontend already speaks HTTP. Replace with a real server
// exposing the same contract (see README) when moving to the main website.

interface Options {
  route: string;
  file: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function jsonFileApi({ route, file }: Options): Plugin {
  // Serialize writes so concurrent saves can't interleave.
  let writeQueue = Promise.resolve();

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== route) return next();
    try {
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(await fs.readFile(file, 'utf8'));
        return;
      }
      if (req.method === 'PUT') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          return sendJson(res, 400, { error: 'Body is not valid JSON' });
        }
        const errors = validateOccupancyData(parsed);
        if (errors.length) return sendJson(res, 422, { errors });

        const tmp = `${file}.tmp`;
        writeQueue = writeQueue.then(async () => {
          await fs.writeFile(tmp, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
          await fs.rename(tmp, file);
        });
        await writeQueue;
        res.statusCode = 204;
        res.end();
        return;
      }
      res.setHeader('Allow', 'GET, PUT');
      sendJson(res, 405, { error: 'Method not allowed' });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  };

  return {
    name: 'json-file-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
