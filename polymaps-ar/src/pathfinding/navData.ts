/**
 * Navigation data from scraper/pathfinding/build_navigation.py:
 *   nav/index.json            per level the grid frame; links between levels (stairs, lifts,
 *                             passages to other buildings, outdoor between exits); named rooms
 *   nav/levels/<LEVEL_ID>.bin cell classes, run-length encoded: u32 n, n × u16 run, n × u8 class
 */
import type { LngLat } from '../geo';

export interface NavLevelInfo {
  id: string;
  facility: string;
  /** PolyMaps vertical order */
  vo: number;
  /** Grid frame: cell (i, j) centre = (lng0 + (i + .5)·cell / kx, lat1 - (j + .5)·cell / 111132) */
  lng0: number;
  lat1: number;
  kx: number;
  w: number;
  h: number;
}

export type LinkKind = 'stairs' | 'lift' | 'outdoor' | 'passage';
/** [levelA, iA, jA, levelB, iB, jB, kind, cost in metres] (usable both ways) */
export type NavLink = [string, number, number, string, number, number, LinkKind, number];
/** [name, label or use, levelId, i, j] */
export type NavRoom = [string, string, string, number, number];

export interface NavIndex {
  cell: number;
  levels: NavLevelInfo[];
  links: NavLink[];
  rooms: NavRoom[];
}

/** Cell classes: blocked, circulation (corridors, halls, doorways), inside a closed room. */
export const BLOCKED = 0, CIRCULATION = 1, ROOM = 2;

export interface NavGrid {
  info: NavLevelInfo;
  /** Cell class (BLOCKED / CIRCULATION / ROOM), row-major w × h; non-zero = walkable */
  walk: Uint8Array;
}

const M_PER_DEG_LAT = 111_132;

export function decodeGrid(info: NavLevelInfo, buf: ArrayBuffer): NavGrid {
  const n = new DataView(buf).getUint32(0, true);
  const runs = new Uint16Array(buf, 4, n);
  const values = new Uint8Array(buf, 4 + 2 * n, n);
  const walk = new Uint8Array(info.w * info.h);
  let pos = 0;
  for (let k = 0; k < n; k++) {
    if (values[k]) walk.fill(values[k], pos, pos + runs[k]);
    pos += runs[k];
  }
  if (pos !== walk.length) throw new Error(`nav grid ${info.id}: ${pos} cells decoded, expected ${walk.length}`);
  return { info, walk };
}

export function cellCenter(info: NavLevelInfo, cell: number, i: number, j: number): LngLat {
  return { lng: info.lng0 + ((i + 0.5) * cell) / info.kx, lat: info.lat1 - ((j + 0.5) * cell) / M_PER_DEG_LAT };
}

export function cellOf(info: NavLevelInfo, cell: number, p: LngLat): [number, number] {
  return [Math.floor(((p.lng - info.lng0) * info.kx) / cell), Math.floor(((info.lat1 - p.lat) * M_PER_DEG_LAT) / cell)];
}

export type GridLoader = (levelId: string) => Promise<ArrayBuffer>;

export class NavData {
  readonly index: NavIndex;
  private readonly loader: GridLoader;
  private readonly grids = new Map<string, Promise<NavGrid>>();
  private readonly byId: Map<string, NavLevelInfo>;

  constructor(index: NavIndex, loader: GridLoader) {
    this.index = index;
    this.loader = loader;
    this.byId = new Map(index.levels.map((l) => [l.id, l]));
  }

  static async load(baseUrl = 'nav'): Promise<NavData> {
    const res = await fetch(`${baseUrl}/index.json`);
    if (!res.ok) throw new Error(`navigation index: HTTP ${res.status} (run scraper/pathfinding/build_navigation.py)`);
    return new NavData((await res.json()) as NavIndex, async (id) => {
      const r = await fetch(`${baseUrl}/levels/${id}.bin`);
      if (!r.ok) throw new Error(`navigation grid ${id}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
  }

  get cell(): number {
    return this.index.cell;
  }

  level(id: string): NavLevelInfo | undefined {
    return this.byId.get(id);
  }

  levelsOf(facility: string): NavLevelInfo[] {
    return this.index.levels.filter((l) => l.facility === facility);
  }

  grid(id: string): Promise<NavGrid> {
    let g = this.grids.get(id);
    if (!g) {
      const info = this.byId.get(id);
      if (!info) return Promise.reject(new Error(`no navigation grid for ${id}`));
      g = this.loader(id).then((buf) => decodeGrid(info, buf));
      this.grids.set(id, g);
      g.catch(() => this.grids.delete(id));
    }
    return g;
  }

  /** Rooms whose name or label contains all words of the query, best matches first. */
  searchRooms(query: string, limit = 12): NavRoom[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const compact = query.toLowerCase().replace(/\s+/g, '');
    const hits = this.index.rooms.filter((r) => {
      const text = `${r[0]} ${r[1]}`.toLowerCase();
      return words.every((w) => text.includes(w)) || r[0].toLowerCase().replace(/\s+/g, '').startsWith(compact);
    });
    const score = (r: NavRoom) => (r[0].toLowerCase().replace(/\s+/g, '') === compact ? 0 : r[0].toLowerCase().startsWith(query.toLowerCase()) ? 1 : 2);
    return hits.sort((a, b) => score(a) - score(b) || a[0].localeCompare(b[0], 'de', { numeric: true })).slice(0, limit);
  }
}
