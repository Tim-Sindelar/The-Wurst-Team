/**
 * A* over the walkable grids of several levels at once, joined by stair / lift / outdoor links.
 * States are (level, cell); moves are the 8 grid neighbours plus links. A diagonal move needs one of
 * its two side cells free, so reachability equals 4-connectivity (what the builder checks).
 * The heuristic is the straight-line distance to the goal ignoring floors, so it stays admissible.
 * Cells inside closed rooms cost ROOM_PENALTY times more, except the start and goal rooms.
 */
import { ROOM, type NavData, type NavGrid, type NavLevelInfo, type LinkKind } from './navData';

/**
 * Walking through a closed room (meeting room, office with two doors, toilets) costs this many
 * times more than a corridor, except in the rooms where the route starts and ends. PolyMaps' own
 * walkway network only enters rooms on spurs from their doors.
 */
export const ROOM_PENALTY = 5;

export interface GridPoint {
  levelId: string;
  i: number;
  j: number;
}

export interface SearchStep extends GridPoint {
  /** How this step was reached from the previous one. */
  via: 'walk' | LinkKind;
}

export interface SearchResult {
  steps: SearchStep[];
  /** Total cost in metres (walking distance plus floor change costs). */
  cost: number;
  expanded: number;
}

class MinHeap {
  private f: number[] = [];
  private id: number[] = [];
  get size() {
    return this.f.length;
  }
  push(f: number, id: number) {
    const a = this.f, b = this.id;
    let k = a.length;
    a.push(f);
    b.push(id);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p] <= f) break;
      a[k] = a[p];
      b[k] = b[p];
      k = p;
    }
    a[k] = f;
    b[k] = id;
  }
  pop(): number {
    const a = this.f, b = this.id;
    const top = b[0];
    const lastF = a.pop()!, lastId = b.pop()!;
    const n = a.length;
    if (n > 0) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && a[c + 1] < a[c]) c++;
        if (a[c] >= lastF) break;
        a[k] = a[c];
        b[k] = b[c];
        k = c;
      }
      a[k] = lastF;
      b[k] = lastId;
    }
    return top;
  }
}

interface Level {
  info: NavLevelInfo;
  grid: NavGrid;
  offset: number;
  /** Cell centre (0, 0) in metres east / north of the search's reference point. */
  x0: number;
  y0: number;
  g: Float64Array | null;
  /** Cells of the start / goal room (free of the room penalty). */
  own: Uint8Array | null;
  parent: Int32Array | null;
  closed: Uint8Array | null;
}

const SQRT2 = Math.SQRT2;
const M_PER_DEG_LAT = 111_132;

export async function search(nav: NavData, from: GridPoint, to: GridPoint, maxExpanded = 6_000_000): Promise<SearchResult | null> {
  const fromInfo = nav.level(from.levelId), toInfo = nav.level(to.levelId);
  if (!fromInfo || !toInfo) return null;
  // Levels of both buildings (outdoor links join entrances of the two directly).
  const facilities = new Set([fromInfo.facility, toInfo.facility]);
  const infos = nav.index.levels.filter((l) => facilities.has(l.facility));
  const grids = await Promise.all(infos.map((l) => nav.grid(l.id)));
  const cell = nav.cell;
  const refLat = fromInfo.lat1, refLng = fromInfo.lng0, refKx = fromInfo.kx;
  const levels: Level[] = [];
  const byId = new Map<string, number>();
  let offset = 0;
  infos.forEach((info, n) => {
    byId.set(info.id, n);
    levels.push({
      info, grid: grids[n], offset,
      x0: (info.lng0 - refLng) * refKx + cell / 2,
      y0: (info.lat1 - refLat) * M_PER_DEG_LAT - cell / 2,
      g: null, parent: null, closed: null, own: null,
    });
    offset += info.w * info.h;
  });
  const levelOfId = (id: number) => {
    let lo = 0, hi = levels.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (levels[mid].offset <= id) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const touch = (L: Level) => {
    if (!L.g) {
      L.g = new Float64Array(L.info.w * L.info.h).fill(Infinity);
      L.parent = new Int32Array(L.info.w * L.info.h).fill(-1);
      L.closed = new Uint8Array(L.info.w * L.info.h);
    }
    return L;
  };

  // Links between loaded levels, by global cell id, both directions.
  const links = new Map<number, { to: number; cost: number; kind: LinkKind }[]>();
  for (const [la, ia, ja, lb, ib, jb, kind, cost] of nav.index.links) {
    const a = byId.get(la), b = byId.get(lb);
    if (a === undefined || b === undefined) continue;
    const A = levels[a], B = levels[b];
    const idA = A.offset + ja * A.info.w + ia, idB = B.offset + jb * B.info.w + ib;
    if (!links.has(idA)) links.set(idA, []);
    if (!links.has(idB)) links.set(idB, []);
    links.get(idA)!.push({ to: idB, cost, kind });
    links.get(idB)!.push({ to: idA, cost, kind });
  }

  const S = levels[byId.get(from.levelId)!], T = levels[byId.get(to.levelId)!];
  // The rooms the route starts and ends in: flood fill over ROOM cells from each end.
  const markOwn = (L: Level, i: number, j: number) => {
    const { w, h } = L.info;
    const walk = L.grid.walk;
    if (walk[j * w + i] !== ROOM) return;
    const own = (L.own ??= new Uint8Array(w * h));
    const stack = [j * w + i];
    own[j * w + i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const ci = c % w, cj = (c - ci) / w;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const n = nj * w + ni;
        if (walk[n] === ROOM && !own[n]) {
          own[n] = 1;
          stack.push(n);
        }
      }
    }
  };
  markOwn(S, from.i, from.j);
  markOwn(T, to.i, to.j);
  const startId = S.offset + from.j * S.info.w + from.i;
  const goalId = T.offset + to.j * T.info.w + to.i;
  const gx = T.x0 + to.i * cell, gy = T.y0 - to.j * cell;
  const h = (L: Level, i: number, j: number) => Math.hypot(L.x0 + i * cell - gx, L.y0 - j * cell - gy);

  touch(S).g![startId - S.offset] = 0;
  const open = new MinHeap();
  open.push(h(S, from.i, from.j), startId);
  const viaLink = new Map<number, LinkKind>();
  let expanded = 0;

  while (open.size) {
    const id = open.pop();
    if (id === goalId) break;
    const L = levels[levelOfId(id)];
    const local = id - L.offset;
    if (L.closed![local]) continue; // stale heap entry
    L.closed![local] = 1;
    if (++expanded > maxExpanded) return null;
    const { w, h: hh } = L.info;
    const i = local % w, j = (local - i) / w;
    const g0 = L.g![local];
    const walk = L.grid.walk;
    for (let dj = -1; dj <= 1; dj++) {
      const nj = j + dj;
      if (nj < 0 || nj >= hh) continue;
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        if (ni < 0 || ni >= w) continue;
        const n = nj * w + ni;
        if (!walk[n]) continue;
        if (di && dj && !walk[j * w + ni] && !walk[nj * w + i]) continue; // no squeezing between two corners
        const penalty = walk[n] === ROOM && !L.own?.[n] ? ROOM_PENALTY : 1;
        const g = g0 + (di && dj ? SQRT2 : 1) * cell * penalty;
        if (g < L.g![n]) {
          L.g![n] = g;
          L.parent![n] = id;
          viaLink.delete(L.offset + n);
          open.push(g + h(L, ni, nj), L.offset + n);
        }
      }
    }
    for (const link of links.get(id) ?? []) {
      const M = touch(levels[levelOfId(link.to)]);
      const n = link.to - M.offset;
      const g = g0 + link.cost;
      if (g < M.g![n]) {
        M.g![n] = g;
        M.parent![n] = id;
        viaLink.set(link.to, link.kind);
        const mi = n % M.info.w;
        open.push(g + h(M, mi, (n - mi) / M.info.w), link.to);
      }
    }
  }

  if (!T.g || T.g[goalId - T.offset] === Infinity) return null;
  const steps: SearchStep[] = [];
  for (let id = goalId; id !== -1; ) {
    const L = levels[levelOfId(id)];
    const local = id - L.offset;
    const i = local % L.info.w;
    const parent = L.parent![local];
    const linkKind = viaLink.get(id);
    const parentLevel = parent === -1 ? L : levels[levelOfId(parent)];
    steps.push({ levelId: L.info.id, i, j: (local - i) / L.info.w, via: linkKind && parentLevel !== L ? linkKind : 'walk' });
    id = parent;
  }
  steps.reverse();
  return { steps, cost: T.g[goalId - T.offset], expanded };
}

/** Nearest walkable cell to (i, j) within `radius` cells, by expanding rings. */
export function nearestWalkable(grid: NavGrid, i: number, j: number, radius = 40): [number, number] | null {
  const { w, h } = grid.info;
  for (let r = 0; r <= radius; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= w || y >= h || !grid.walk[y * w + x]) continue;
        const d = di * di + dj * dj;
        if (d < bestD) [best, bestD] = [[x, y], d];
      }
    }
    if (best) return best;
  }
  return null;
}
