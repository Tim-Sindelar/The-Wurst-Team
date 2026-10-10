/**
 * Checks the walkable grids against PolyMaps' own walkway network (EGDB_Public_Network, the lines
 * ArcGIS Indoors routes on): for random pairs of network nodes on the same floor, compare our route
 * with the network's shortest path.
 *   ratio ≈ 1    agree (our path is straightened, so slightly below 1 is normal)
 *   ratio << 1   we walk through something the network goes around: a leak through a wall
 *   ratio >> 1   we detour: a missing door or a room cut off
 *   no route     the grid doesn't connect the two points at all
 *
 *   npm run validate-routes -- [--pairs 400] [--seed 1] [--facility ETH.HG]
 *   npm run validate-routes -- --rooms [--pairs 300]   room-to-room success rate and speed
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { distance, inMultiPolygon, seededRandom, type LngLat } from '../../src/geo';
import { findRoute } from '../../src/pathfinding/route';
import { loadNavFromDisk } from './route';

const DATA = fileURLToPath(new URL('../../../scraper/polymaps_data/', import.meta.url));
const NETWORK = `${DATA}EGDB_EGDB_Public_Network_2.geojson`;
const UNITS = `${DATA}EGDB_Units_3.geojson`;
/** Pairs are drawn between network nodes in these rooms: inside other rooms the network is only a
 * spur from the door, so "we cross the room, it goes around" would look like a leak. */
const CIRCULATION = new Set(['Gang', 'Korridor / Gang', 'Foyer', 'Eingang und Ausgang', 'Halle', 'Rampe']);

interface Feature {
  properties: { LEVEL_ID: string; LEVEL_NAME_FROM: string; LEVEL_NAME_TO: string; FACILITY_ID: string };
  geometry: { type: string; coordinates: number[][] | number[][][] } | null;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/**
 * Per level: the walkway graph. Lines often meet at T-junctions (one ends on the middle of another),
 * so segments are split at every line end within JUNCTION_M of them, not only joined at shared ends.
 */
const JUNCTION_M = 0.3;

export function levelGraphs(features: Feature[]) {
  const segsByLevel = new Map<string, [number[], number[]][]>();
  for (const f of features) {
    const p = f.properties;
    if (!f.geometry || p.LEVEL_NAME_FROM !== p.LEVEL_NAME_TO) continue;
    const lines = (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]) as number[][][];
    const segs = segsByLevel.get(p.LEVEL_ID) ?? [];
    for (const line of lines) for (let k = 0; k + 1 < line.length; k++) segs.push([line[k], line[k + 1]]);
    segsByLevel.set(p.LEVEL_ID, segs);
  }
  const graphs = new Map<string, { pts: LngLat[]; key: Map<string, number>; adj: [number, number][][] }>();
  for (const [levelId, segs] of segsByLevel) {
    const g = { pts: [] as LngLat[], key: new Map<string, number>(), adj: [] as [number, number][][] };
    const node = (c: number[]) => {
      const k = `${c[0].toFixed(7)},${c[1].toFixed(7)}`;
      let n = g.key.get(k);
      if (n === undefined) {
        n = g.pts.length;
        g.key.set(k, n);
        g.pts.push({ lng: c[0], lat: c[1] });
        g.adj.push([]);
      }
      return n;
    };
    // Local metric frame for this level.
    const lat0 = segs[0][0][1], kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 111_132;
    const xy = (c: number[]) => [c[0] * kx, c[1] * ky];
    // Bucket all segment ends on a 2 m grid.
    const ends = new Map<string, number[][]>();
    const bucket = (x: number, y: number) => `${Math.floor(x / 2)},${Math.floor(y / 2)}`;
    for (const seg of segs) for (const c of seg) {
      const [x, y] = xy(c);
      const b = bucket(x, y);
      ends.set(b, [...(ends.get(b) ?? []), c]);
    }
    for (const [a, b] of segs) {
      const [ax, ay] = xy(a), [bx, by] = xy(b);
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const onSeg: [number, number[]][] = [];
      for (let gx = Math.floor(Math.min(ax, bx) / 2) - 1; gx <= Math.floor(Math.max(ax, bx) / 2) + 1; gx++) {
        for (let gy = Math.floor(Math.min(ay, by) / 2) - 1; gy <= Math.floor(Math.max(ay, by) / 2) + 1; gy++) {
          for (const c of ends.get(`${gx},${gy}`) ?? []) {
            const [cx, cy] = xy(c);
            const t = len2 ? ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / len2 : 0;
            if (t <= 0.001 || t >= 0.999) continue;
            const d = Math.hypot(ax + t * (bx - ax) - cx, ay + t * (by - ay) - cy);
            if (d < JUNCTION_M) onSeg.push([t, c]);
          }
        }
      }
      const chain = [a, ...onSeg.sort((u, v) => u[0] - v[0]).map(([, c]) => c), b];
      for (let k = 0; k + 1 < chain.length; k++) {
        const u = node(chain[k]), v = node(chain[k + 1]);
        if (u === v) continue;
        const d = distance(g.pts[u], g.pts[v]);
        g.adj[u].push([v, d]);
        g.adj[v].push([u, d]);
      }
    }
    graphs.set(levelId, g);
  }
  return graphs;
}

export function dijkstra(adj: [number, number][][], from: number, parent?: Int32Array): Float64Array {
  const dist = new Float64Array(adj.length).fill(Infinity);
  dist[from] = 0;
  const heap: [number, number][] = [[0, from]];
  while (heap.length) {
    // small graphs: a sorted-insert queue is plenty
    const [d, u] = heap.shift()!;
    if (d > dist[u]) continue;
    for (const [v, w] of adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        if (parent) parent[v] = u;
        let lo = 0, hi = heap.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (heap[mid][0] < nd) lo = mid + 1;
          else hi = mid;
        }
        heap.splice(lo, 0, [nd, v]);
      }
    }
  }
  return dist;
}

/** Random pairs of rooms people go to (not shafts or cupboards): same building, and two buildings. */
async function roomPairs(pairs: number, rand: () => number) {
  const nav = loadNavFromDisk();
  const skip = /Betriebsraum|Schrank|Lager|Sicherheitsraum|Reinraum|Aufzug|Treppe|Gang/;
  const rooms = nav.index.rooms.filter((r) => !skip.test(r[1]));
  const byFacility = new Map<string, typeof rooms>();
  for (const r of rooms) {
    const f = nav.level(r[2])!.facility;
    byFacility.set(f, [...(byFacility.get(f) ?? []), r]);
  }
  const facilities = [...byFacility.keys()].filter((f) => byFacility.get(f)!.length > 20);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const { cellCenter } = await import('../../src/pathfinding/navData');
  const at = (r: (typeof rooms)[number]) => ({ ...cellCenter(nav.level(r[2])!, nav.cell, r[3], r[4]), levelId: r[2] });
  for (const mode of ['same building', 'two buildings'] as const) {
    let ok = 0, ms = 0;
    const failures: string[] = [];
    for (let n = 0; n < pairs; n++) {
      const f1 = pick(facilities);
      const a = pick(byFacility.get(f1)!);
      const b = mode === 'same building' ? pick(byFacility.get(f1)!) : pick(rooms.filter((r) => nav.level(r[2])!.facility !== f1 && Math.abs(nav.level(r[2])!.lat1 - nav.level(a[2])!.lat1) < 0.004));
      if (!b || a === b) continue;
      const t = performance.now();
      try {
        await findRoute(nav, at(a), at(b));
        ok++;
      } catch {
        if (failures.length < 8) failures.push(`${a[0]} -> ${b[0]}`);
      }
      ms += performance.now() - t;
    }
    console.log(`${mode}: ${ok}/${pairs} routed (${Math.round((100 * ok) / pairs)} %), ${Math.round(ms / pairs)} ms per route`);
    if (failures.length) console.log('  e.g. ' + failures.join(', '));
  }
}

async function main() {
  if (process.argv.includes('--rooms')) return roomPairs(Number(arg('--pairs', '200')), seededRandom(Number(arg('--seed', '1'))));
  const pairs = Number(arg('--pairs', '400'));
  const rand = seededRandom(Number(arg('--seed', '1')));
  const facility = arg('--facility', '');
  const nav = loadNavFromDisk();
  const features = (JSON.parse(readFileSync(NETWORK, 'utf-8')) as { features: Feature[] }).features
    .filter((f) => !facility || f.properties.FACILITY_ID === facility);
  // Circulation rooms per level, to keep only network nodes in corridors and halls.
  const corridors = new Map<string, number[][][][]>();
  for (const u of (JSON.parse(readFileSync(UNITS, 'utf-8')) as { features: { properties: Record<string, string>; geometry: { type: string; coordinates: any } | null }[] }).features) {
    const use = u.properties.USE_TYPE || u.properties.RaumTyp;
    if (!u.geometry || !CIRCULATION.has(use)) continue;
    const polys = u.geometry.type === 'Polygon' ? [u.geometry.coordinates] : u.geometry.coordinates;
    corridors.set(u.properties.LEVEL_ID, [...(corridors.get(u.properties.LEVEL_ID) ?? []), ...polys]);
  }
  const graphs = [...levelGraphs(features)]
    .filter(([id, g]) => nav.level(id) && g.pts.length > 20)
    .map(([id, g]) => {
      const polys = corridors.get(id) ?? [];
      const inCorridor = g.pts.map((p) => inMultiPolygon(p, polys));
      return [id, g, inCorridor] as const;
    })
    .filter(([, , c]) => c.filter(Boolean).length > 5);
  const weights = graphs.map(([, g]) => g.pts.length);
  const total = weights.reduce((a, b) => a + b, 0);

  const rows: { level: string; from: LngLat; to: LngLat; network: number; ours: number | null; floors: number; error?: string }[] = [];
  for (let n = 0; n < pairs; n++) {
    let r = rand() * total, k = 0;
    while ((r -= weights[k]) > 0) k++;
    const [levelId, g, inCorridor] = graphs[k];
    const candidates = [...inCorridor.keys()].filter((i) => inCorridor[i]);
    const a = candidates[Math.floor(rand() * candidates.length)];
    const dist = dijkstra(g.adj, a);
    const reachable = candidates.filter((b) => dist[b] > 15 && dist[b] < Infinity);
    if (!reachable.length) continue;
    const b = reachable[Math.floor(rand() * reachable.length)];
    const row = { level: levelId, from: g.pts[a], to: g.pts[b], network: dist[b], ours: null as number | null, floors: 0, error: undefined as string | undefined };
    try {
      const route = await findRoute(nav, { ...g.pts[a], levelId }, { ...g.pts[b], levelId });
      row.ours = route.length;
      row.floors = new Set(route.legs.map((l) => l.levelId)).size;
    } catch (e) {
      row.error = (e as Error).message;
    }
    rows.push(row);
    if ((n + 1) % 100 === 0) process.stderr.write(`  ${n + 1}/${pairs}\n`);
  }

  const ok = rows.filter((r) => r.ours !== null);
  const ratios = ok.map((r) => r.ours! / r.network).sort((x, y) => x - y);
  const q = (p: number) => ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))];
  const share = (lo: number, hi: number) => ratios.filter((x) => x >= lo && x <= hi).length / rows.length;
  console.log(`${rows.length} same-floor corridor-to-corridor pairs on ${new Set(rows.map((r) => r.level)).size} floors${facility ? ` (${facility})` : ''}`);
  console.log(`  routed: ${ok.length} (${Math.round((100 * ok.length) / rows.length)} %), no route: ${rows.length - ok.length}`);
  console.log(`  length ours / network: p10 ${q(0.1).toFixed(2)}, median ${q(0.5).toFixed(2)}, p90 ${q(0.9).toFixed(2)}`);
  console.log(`  agree (0.8-1.2): ${Math.round(100 * share(0.8, 1.2))} %, much shorter (<0.7, leak?): ${Math.round(100 * share(0, 0.7))} %, much longer (>1.5, detour): ${Math.round(100 * share(1.5, Infinity))} %`);
  console.log(`  routes using another floor: ${ok.filter((r) => r.floors > 1).length}`);
  const out = fileURLToPath(new URL('../../public/nav/validation.json', import.meta.url));
  writeFileSync(out, JSON.stringify(rows.map((r) => ({ ...r, ratio: r.ours === null ? null : r.ours / r.network })), null, 1));
  console.log(`  details: ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
