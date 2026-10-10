import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { DatasetDocument, DatasetMeta, DatasetResponse } from '../src/datasets/types';

// Campus datasets (../datasets/<id>/): each folder has a dataset.json and a
// fetch.py that prints one DatasetDocument. This middleware runs the fetcher
// when the cached copy (data/cache/datasets/<id>.json) is older than the
// dataset's ttlSeconds, and answers from the cache meanwhile:
//   GET /api/datasets         → DatasetMeta[]
//   GET /api/datasets/<id>    → DatasetResponse (?refresh=1 forces a fetch)

interface Options {
  /** The datasets folder (one subfolder per dataset). */
  dir: string;
  /** Where fetched documents are kept. */
  cacheDir: string;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const FETCH_TIMEOUT_MS = 120_000;
/** After a failed fetch, wait this long before running the fetcher again. */
const RETRY_MS = 60_000;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function datasetsApi(opts: Options): Plugin {
  const running = new Map<string, Promise<void>>();
  const lastError = new Map<string, { at: number; message: string }>();

  async function listMetas(): Promise<DatasetMeta[]> {
    const out: DatasetMeta[] = [];
    for (const entry of await fs.readdir(opts.dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID.test(entry.name)) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(opts.dir, entry.name, 'dataset.json'), 'utf8')) as DatasetMeta;
        out.push({ ...meta, id: entry.name });
      } catch {
        // A folder without dataset.json is not a dataset.
      }
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  async function readMeta(id: string): Promise<DatasetMeta | null> {
    if (!ID.test(id)) return null;
    try {
      return { ...JSON.parse(await fs.readFile(path.join(opts.dir, id, 'dataset.json'), 'utf8')), id };
    } catch {
      return null;
    }
  }

  const cacheFile = (id: string) => path.join(opts.cacheDir, `${id}.json`);

  async function readCache(id: string): Promise<DatasetDocument | null> {
    try {
      return JSON.parse(await fs.readFile(cacheFile(id), 'utf8')) as DatasetDocument;
    } catch {
      return null;
    }
  }

  /** Runs datasets/<id>/fetch.py into the cache; one run per dataset at a time. */
  function refresh(id: string): Promise<void> {
    const current = running.get(id);
    if (current) return current;
    const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    const script = path.join(opts.dir, id, 'fetch.py');
    const run = fs
      .mkdir(opts.cacheDir, { recursive: true })
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            execFile(python, [script, '--out', cacheFile(id)], { timeout: FETCH_TIMEOUT_MS }, (err, _stdout, stderr) => {
              if (stderr.trim()) console.warn(stderr.trim().split('\n').map((l) => `[datasets] ${l}`).join('\n'));
              if (err) reject(new Error(`${id}/fetch.py failed: ${stderr.trim().split('\n').pop() || err.message}`));
              else resolve();
            });
          }),
      )
      .then(
        () => void lastError.delete(id),
        (err: Error) => void lastError.set(id, { at: Date.now(), message: err.message }),
      )
      .finally(() => running.delete(id));
    running.set(id, run);
    return run;
  }

  async function respond(id: string, force: boolean): Promise<[number, DatasetResponse | { error: string }]> {
    const meta = await readMeta(id);
    if (!meta) return [404, { error: `Unknown dataset ${id}` }];
    let doc = await readCache(id);
    const age = (d: DatasetDocument | null) => (d ? (Date.now() - Date.parse(d.fetchedAt)) / 1000 : Infinity);
    const failed = lastError.get(id);
    const mayRetry = !failed || Date.now() - failed.at > RETRY_MS || force;
    if ((force || age(doc) > meta.ttlSeconds) && mayRetry) {
      const run = refresh(id);
      // Without a cached copy (or when asked to), wait for the fetch; otherwise answer stale data now.
      if (!doc || force) {
        await run;
        doc = await readCache(id);
      }
    }
    if (!doc) return [502, { error: lastError.get(id)?.message ?? `No data for ${id} yet` }];
    return [
      200,
      {
        meta,
        document: doc,
        ageSeconds: Math.round(age(doc)),
        refreshing: running.has(id),
        lastError: lastError.get(id)?.message ?? null,
      },
    ];
  }

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '', 'http://local');
    if (!url.pathname.startsWith('/api/datasets')) return next();
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    try {
      const rest = url.pathname.slice('/api/datasets'.length).replace(/^\/|\/$/g, '');
      if (!rest) return sendJson(res, 200, await listMetas());
      const [status, body] = await respond(rest, url.searchParams.get('refresh') === '1');
      sendJson(res, status, body);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  return {
    name: 'datasets-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
