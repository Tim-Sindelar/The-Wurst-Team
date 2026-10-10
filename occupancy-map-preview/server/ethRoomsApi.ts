import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { roomKey, unitIdName, type EthRoomsResponse, type EthSnapshot, type RoomPlace } from '../src/domain/ethRooms';

// Live ETH room data for the map. eth_room_dashboard.py talks to ETH (it keeps
// the hourly snapshot file and its fetch log); this middleware forwards
// /api/eth/* to it and adds where each ETH room is on the PolyMaps floor plans,
// which only exist here (public/floors). When the Python service isn't running
// yet, the first request starts it.

interface Options {
  /** Base URL of eth_room_dashboard.py. */
  target: string;
  /** public/floors, written by scraper/extract_floors.py. */
  floorsDir: string;
  /** Path of eth_room_dashboard.py, for starting it. */
  script: string;
  snapshotFile: string;
  autostart: boolean;
}

// ---- floor plan matching -------------------------------------------------------

interface RawLevel {
  id: string;
  origin: [number, number];
  scale: number;
  rooms: { id: string; name: string | null; label: string | null; rings: number[][][] }[];
}

interface PlanIndex {
  stamp: number;
  /** Room key → places, by PolyMaps room name, by unit id and by display label (in that order of trust). */
  byName: Map<string, RoomPlace[]>;
  byUnit: Map<string, RoomPlace[]>;
  byLabel: Map<string, RoomPlace[]>;
}

/** Area-weighted centroid of the largest polygon's outer ring, from a level file's flat micro-degree rings. */
function centerOf(level: RawLevel, rings: number[][][]): { lat: number; lng: number } {
  const [lng0, lat0] = level.origin;
  let best = { area: -1, x: 0, y: 0 };
  for (const [outer] of rings) {
    if (!outer || outer.length < 2) continue;
    const n = outer.length / 2;
    let a = 0, cx = 0, cy = 0, sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      const x0 = outer[2 * i], y0 = outer[2 * i + 1];
      const j = (i + 1) % n;
      const x1 = outer[2 * j], y1 = outer[2 * j + 1];
      const f = x0 * y1 - x1 * y0;
      a += f;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
      sx += x0;
      sy += y0;
    }
    const area = Math.abs(a / 2);
    if (area > best.area) best = area > 0 ? { area, x: cx / (3 * a), y: cy / (3 * a) } : { area, x: sx / n, y: sy / n };
  }
  return { lat: +(lat0 + best.y / level.scale).toFixed(7), lng: +(lng0 + best.x / level.scale).toFixed(7) };
}

const ROOM_NAME = /^[A-Z0-9]+ \S+ \S+$/i;

async function buildPlanIndex(floorsDir: string, stamp: number): Promise<PlanIndex> {
  const index = JSON.parse(await fs.readFile(path.join(floorsDir, 'index.json'), 'utf8')) as {
    levels: { id: string; floor: number }[];
  };
  const out: PlanIndex = { stamp, byName: new Map(), byUnit: new Map(), byLabel: new Map() };
  const add = (map: Map<string, RoomPlace[]>, name: string | null, place: RoomPlace) => {
    if (!name || !ROOM_NAME.test(name.trim())) return;
    const key = roomKey(name);
    (map.get(key) ?? map.set(key, []).get(key)!).push(place);
  };
  for (const info of index.levels) {
    let level: RawLevel;
    try {
      level = JSON.parse(await fs.readFile(path.join(floorsDir, 'levels', `${info.id}.json`), 'utf8'));
    } catch {
      continue;
    }
    for (const room of level.rooms) {
      const place: RoomPlace = { unitId: room.id, levelId: info.id, floor: info.floor, ...centerOf(level, room.rings) };
      add(out.byName, room.name, place);
      add(out.byUnit, unitIdName(room.id), place);
      add(out.byLabel, room.label, place);
    }
  }
  return out;
}

/** Places of every ETH room, looked up by name first, then by unit id, then by label. */
export function matchRooms(snapshot: EthSnapshot, plans: PlanIndex | null) {
  const matches: Record<string, RoomPlace[]> = {};
  const unmatched: string[] = [];
  for (const room of snapshot.rooms) {
    const key = roomKey(room.id);
    const places = plans && (plans.byName.get(key) ?? plans.byUnit.get(key) ?? plans.byLabel.get(key));
    if (places?.length) matches[room.id] = places;
    else unmatched.push(room.id);
  }
  return { matches, unmatched };
}

// ---- middleware -----------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

const ROUTES: Record<string, string> = {
  '/api/eth/rooms': '/api/snapshot',
  '/api/eth/room': '/api/room',
  '/api/eth/file': '/api/file',
  '/api/eth/uzh': '/api/uzh',
};

export function ethRoomsApi(opts: Options): Plugin {
  let plans: Promise<PlanIndex | null> | null = null;
  let matched: { key: string; value: ReturnType<typeof matchRooms> } | null = null;
  let child: ChildProcess | null = null;
  let started = false;
  let startError: string | null = null;

  /** The plan index, rebuilt when index.json changes (re-running extract_floors.py). */
  async function planIndex(): Promise<PlanIndex | null> {
    let stamp: number;
    try {
      stamp = (await fs.stat(path.join(opts.floorsDir, 'index.json'))).mtimeMs;
    } catch {
      return null;
    }
    const current = await plans;
    if (!plans || !current || current.stamp !== stamp) {
      plans = buildPlanIndex(opts.floorsDir, stamp).catch((err) => {
        console.warn('[eth-rooms] reading floor plans failed', err);
        return null;
      });
    }
    return plans;
  }

  function startService() {
    if (started || !opts.autostart) return;
    started = true;
    const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    const port = new URL(opts.target).port || '80';
    console.log(`[eth-rooms] starting ${python} ${path.basename(opts.script)} on port ${port}`);
    child = spawn(python, [opts.script, '--no-browser', '--port', port, '--snapshot-file', opts.snapshotFile], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', (err) => {
      startError = `Could not start ${python}: ${err.message}`;
      child = null;
    });
    child.on('exit', () => (child = null));
    const stop = () => child?.kill();
    process.once('exit', stop);
  }

  /** GET from the Python service, starting it (and waiting for it) on the first refused connection. */
  async function upstream(pathAndQuery: string): Promise<Response> {
    const url = opts.target + pathAndQuery;
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetch(url, { signal: AbortSignal.timeout(60_000) });
      } catch (err) {
        const refused = (err as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED';
        if (!refused) throw new Error(`ETH room service at ${opts.target}: ${err instanceof Error ? err.message : String(err)}`);
        if (!opts.autostart || startError || attempt >= 20) {
          throw new Error(
            startError ??
              `ETH room service not reachable at ${opts.target}. Start it with: python eth_room_dashboard.py --no-browser`,
          );
        }
        startService();
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const [route, query = ''] = (req.url ?? '').split('?');
    const target = ROUTES[route];
    if (!target) return next();
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    try {
      const up = await upstream(target + (query ? `?${query}` : ''));
      if (route === '/api/eth/rooms') {
        if (up.status === 404) throw new Error('eth_room_dashboard.py is outdated (no /api/snapshot); restart it');
        const body = (await up.json()) as Omit<EthRoomsResponse, 'matches' | 'unmatched' | 'floorPlans'> & { error?: string };
        if (!up.ok) throw new Error(body.error ?? `ETH room service answered ${up.status}`);
        const index = await planIndex();
        let match = { matches: {}, unmatched: body.snapshot?.rooms.map((r) => r.id) ?? [] } as ReturnType<typeof matchRooms>;
        if (body.snapshot) {
          const key = `${body.snapshot.fetchedAt}|${index?.stamp ?? 'none'}`;
          if (matched?.key !== key) matched = { key, value: matchRooms(body.snapshot, index) };
          match = matched.value;
        }
        const out: EthRoomsResponse = { ...body, ...match, floorPlans: index !== null };
        return sendJson(res, 200, out);
      }
      // Room sheets, photos and the UZH data are passed through as they are.
      res.statusCode = up.status;
      res.setHeader('Content-Type', up.headers.get('content-type') ?? 'application/octet-stream');
      const cache = up.headers.get('cache-control');
      if (cache) res.setHeader('Cache-Control', cache);
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch (err) {
      sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  return {
    name: 'eth-rooms-api',
    configureServer(server) {
      server.middlewares.use(handler);
      server.httpServer?.once('close', () => child?.kill());
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
      server.httpServer?.once('close', () => child?.kill());
    },
  };
}
