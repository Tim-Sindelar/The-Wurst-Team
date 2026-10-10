import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type {
  DatasetDocument,
  DatasetMeta,
  DatasetResponse,
} from '../src/campus-map/datasets/types';

// Campus datasets (../datasets/<id>/): each folder has a dataset.json and a
// fetch.py that prints one DatasetDocument. This middleware runs the fetcher
// when the cached copy (data/cache/datasets/<id>.json) is older than the
// dataset's ttlSeconds, and answers from the cache meanwhile:
//   GET /api/datasets         → DatasetMeta[]
//   GET /api/datasets/<id>    → DatasetResponse (?refresh=1 forces a fetch)
//   ?at=2026-10-20T14:00      → the data at that Zurich time (fetch.py --at), cached
//                               apart in data/cache/datasets/at/<id>/. Datasets whose
//                               dataset.json says time.support "live" answer with now.

interface Options {
  /** The datasets folder (one subfolder per dataset). */
  dir: string;
  /** Where fetched documents are kept. */
  cacheDir: string;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** Documents for a time over a day ago don't change any more: kept this long. */
const PAST_TTL_SECONDS = 30 * 86400;
/** Documents kept per dataset in cache/datasets/at/<id>/. */
const AT_KEPT = 40;
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
        const meta = JSON.parse(
          await fs.readFile(
            path.join(opts.dir, entry.name, 'dataset.json'),
            'utf8',
          ),
        ) as DatasetMeta;
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
      return {
        ...JSON.parse(
          await fs.readFile(path.join(opts.dir, id, 'dataset.json'), 'utf8'),
        ),
        id,
      };
    } catch {
      return null;
    }
  }

  const atDir = (id: string) => path.join(opts.cacheDir, 'at', id);
  const cacheFile = (id: string, at: string | null) =>
    at
      ? path.join(atDir(id), `${at.replace(':', '')}.json`)
      : path.join(opts.cacheDir, `${id}.json`);
  /** Key of `running` and `lastError`: one per dataset and time. */
  const keyOf = (id: string, at: string | null) => (at ? `${id}@${at}` : id);

  async function readCache(
    id: string,
    at: string | null,
  ): Promise<DatasetDocument | null> {
    try {
      return JSON.parse(
        await fs.readFile(cacheFile(id, at), 'utf8'),
      ) as DatasetDocument;
    } catch {
      return null;
    }
  }

  /** Keeps the newest AT_KEPT documents of a dataset in cache/datasets/at/<id>/. */
  async function pruneAt(id: string) {
    const dir = atDir(id);
    const files = await Promise.all(
      (await fs.readdir(dir))
        .filter((f) => f.endsWith('.json'))
        .map(async (f) => ({
          f,
          t: (await fs.stat(path.join(dir, f))).mtimeMs,
        })),
    );
    for (const { f } of files.sort((a, b) => b.t - a.t).slice(AT_KEPT))
      await fs.rm(path.join(dir, f), { force: true });
  }

  /** Runs datasets/<id>/fetch.py [--at] into the cache; one run per dataset and time at a time. */
  function refresh(id: string, at: string | null): Promise<void> {
    const key = keyOf(id, at);
    const current = running.get(key);
    if (current) return current;
    const python =
      process.env.PYTHON ??
      (process.platform === 'win32' ? 'python' : 'python3');
    const script = path.join(opts.dir, id, 'fetch.py');
    const args = [
      script,
      '--out',
      cacheFile(id, at),
      ...(at ? ['--at', at] : []),
    ];
    const run = fs
      .mkdir(path.dirname(cacheFile(id, at)), { recursive: true })
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            execFile(
              python,
              args,
              { timeout: FETCH_TIMEOUT_MS },
              (err, _stdout, stderr) => {
                if (stderr.trim())
                  console.warn(
                    stderr
                      .trim()
                      .split('\n')
                      .map((l) => `[datasets] ${l}`)
                      .join('\n'),
                  );
                if (err)
                  reject(
                    new Error(
                      `${id}/fetch.py failed: ${stderr.trim().split('\n').pop() || err.message}`,
                    ),
                  );
                else resolve();
              },
            );
          }),
      )
      .then(
        () => {
          lastError.delete(key);
          if (at) return pruneAt(id).catch(() => {});
        },
        (err: Error) =>
          void lastError.set(key, { at: Date.now(), message: err.message }),
      )
      .finally(() => running.delete(key));
    running.set(key, run);
    return run;
  }

  async function respond(
    id: string,
    force: boolean,
    askedAt: string | null,
  ): Promise<[number, DatasetResponse | { error: string }]> {
    const meta = await readMeta(id);
    if (!meta) return [404, { error: `Unknown dataset ${id}` }];
    // Live-only sources answer with now, whatever time was asked for.
    const at = askedAt && meta.time?.support !== 'live' ? askedAt : null;
    const key = keyOf(id, at);
    // Over a day in the past (whatever the time zone), the data doesn't change any more.
    const ttl =
      at && Date.parse(`${at}:00Z`) < Date.now() - 86_400_000
        ? PAST_TTL_SECONDS
        : meta.ttlSeconds;
    let doc = await readCache(id, at);
    const age = (d: DatasetDocument | null) =>
      d ? (Date.now() - Date.parse(d.fetchedAt)) / 1000 : Infinity;
    const failed = lastError.get(key);
    const mayRetry = !failed || Date.now() - failed.at > RETRY_MS || force;
    if ((force || age(doc) > ttl) && mayRetry) {
      const run = refresh(id, at);
      // Without a cached copy (or when asked to), wait for the fetch; otherwise answer stale data now.
      if (!doc || force) {
        await run;
        doc = await readCache(id, at);
      }
    }
    if (!doc)
      return [
        502,
        { error: lastError.get(key)?.message ?? `No data for ${id} yet` },
      ];
    return [
      200,
      {
        meta,
        document: doc,
        at,
        ageSeconds: Math.round(age(doc)),
        refreshing: running.has(key),
        lastError: lastError.get(key)?.message ?? null,
      },
    ];
  }

  const handler = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = new URL(req.url ?? '', 'http://local');
    if (!url.pathname.startsWith('/api/datasets')) return next();
    if (req.method !== 'GET')
      return sendJson(res, 405, { error: 'Method not allowed' });
    try {
      const rest = url.pathname
        .slice('/api/datasets'.length)
        .replace(/^\/|\/$/g, '');
      if (!rest) return sendJson(res, 200, await listMetas());
      const at = url.searchParams.get('at');
      if (at && !AT.test(at))
        return sendJson(res, 400, {
          error: 'at must be YYYY-MM-DDTHH:MM (Zurich time)',
        });
      const [status, body] = await respond(
        rest,
        url.searchParams.get('refresh') === '1',
        at,
      );
      sendJson(res, status, body);
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
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
