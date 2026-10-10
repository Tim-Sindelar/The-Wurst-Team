import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { OccupancyData } from '../src/domain/types';
import { validateOccupancyData } from '../src/domain/validate';
import {
  diffOverrides,
  emptyData,
  emptyOverrides,
  mergeOverrides,
  validateOverrides,
  type AdminOverrides,
} from '../src/domain/overlay';

// Stand-in backend for the preview: serves the dataset over GET/PUT so the
// frontend already speaks HTTP. Replace with a real server exposing the same
// contract (see README) when moving to the main website.
//
// Storage is two files: `generated` is written only by scraper/extract_floors.py,
// `overrides` only by this API. GET returns generated + overrides merged;
// PUT stores the difference between the saved data and generated in overrides.

interface Options {
  route: string;
  /** Pipeline output; read-only here. */
  generated: string;
  /** Admin edits, applied on top of `generated`. */
  overrides: string;
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

async function readJson<T>(file: string, fallback: () => T, validate: (v: unknown) => string[]): Promise<T> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback();
    throw err;
  }
  const parsed: unknown = JSON.parse(text);
  const errors = validate(parsed);
  if (errors.length) throw new Error(`${file} is invalid:\n${errors.join('\n')}`);
  return parsed as T;
}

export function jsonFileApi({ route, generated, overrides }: Options): Plugin {
  // Serialize writes so concurrent saves can't interleave.
  let writeQueue = Promise.resolve();

  const readGenerated = () => readJson<OccupancyData>(generated, emptyData, validateOccupancyData);
  const readOverrides = () => readJson<AdminOverrides>(overrides, emptyOverrides, validateOverrides);

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== route) return next();
    try {
      if (req.method === 'GET') {
        const merged = mergeOverrides(await readGenerated(), await readOverrides());
        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, 200, merged);
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

        writeQueue = writeQueue.then(async () => {
          const diff = diffOverrides(await readGenerated(), parsed as OccupancyData, await readOverrides());
          const tmp = `${overrides}.tmp`;
          await fs.writeFile(tmp, JSON.stringify(diff, null, 2) + '\n', 'utf8');
          await fs.rename(tmp, overrides);
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

/**
 * A single JSON document over GET/PUT, stored as-is (e.g. the map style
 * defaults). GET answers 404 while the file doesn't exist.
 */
export function jsonDocumentApi({ route, file, validate }: { route: string; file: string; validate: (v: unknown) => string[] }): Plugin {
  let writeQueue = Promise.resolve();

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== route) return next();
    try {
      if (req.method === 'GET') {
        const doc = await readJson<unknown>(file, () => null, validate);
        res.setHeader('Cache-Control', 'no-store');
        return doc === null ? sendJson(res, 404, { error: 'Not saved yet' }) : sendJson(res, 200, doc);
      }
      if (req.method === 'PUT') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          return sendJson(res, 400, { error: 'Body is not valid JSON' });
        }
        const errors = validate(parsed);
        if (errors.length) return sendJson(res, 422, { errors });

        writeQueue = writeQueue.then(async () => {
          const tmp = `${file}.tmp`;
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
    name: `json-document-api:${route}`,
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/** Map style file: { light: {...}, dark: {...} }, the per-theme minimal styles. */
export function validateMapStyle(input: unknown): string[] {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(input)) return ['root must be an object'];
  const errors: string[] = [];
  for (const theme of ['light', 'dark']) {
    const s = input[theme];
    if (!isObj(s)) errors.push(`${theme} must be an object`);
    else if (!isObj(s.parts)) errors.push(`${theme}.parts must be an object`);
  }
  return errors;
}
