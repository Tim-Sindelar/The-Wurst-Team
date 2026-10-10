/**
 * Floor plans from scraper/extract_floors.py (served under /floors, see vite.config.ts):
 *   index.json          levels (id, facility, floor, bbox, outline) and building footprints
 *   levels/<id>.json    rooms and wall / door / stair lines of one level, as flat integer arrays in
 *                       micro-degrees relative to the level's origin
 */
import type { LngLat } from '../geo';

export interface LevelSummary {
  id: string;
  facilityId: string;
  name: string;
  label: string;
  floor: number;
  bbox: [number, number, number, number];
  outline: { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface FacilitySummary {
  id: string;
  name: string;
  address: string | null;
  outline: { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface FloorIndex {
  floors: number[];
  levels: LevelSummary[];
  facilities: FacilitySummary[];
}

interface RawRoom {
  id: string;
  name: string | null;
  label: string | null;
  use: string;
  kind: string;
  area: number;
  rings: number[][][];
}

interface RawLevel {
  id: string;
  origin: [number, number];
  scale: number;
  rooms: RawRoom[];
  lines: Partial<Record<'wall' | 'door' | 'stair', number[][]>>;
}

/** Polygons and lines in metres east / north of `origin`. */
export interface Room {
  id: string;
  name: string | null;
  label: string | null;
  use: string;
  kind: string;
  area: number;
  /** polygons -> rings -> flat [x0, y0, x1, y1, ...] in metres */
  polygons: Float32Array[][];
  centroid: { x: number; y: number };
}

export interface LevelPlan {
  id: string;
  origin: LngLat;
  rooms: Room[];
  walls: Float32Array[];
  doors: Float32Array[];
  stairs: Float32Array[];
}

const M_PER_DEG_LAT = 111_132;

/** Decode a level into local metres around `origin` (the AR anchor or the map centre). */
export function decodeLevel(raw: RawLevel, origin: LngLat): LevelPlan {
  const kx = (111_320 * Math.cos((origin.lat * Math.PI) / 180)) / raw.scale;
  const ky = M_PER_DEG_LAT / raw.scale;
  const ox = (raw.origin[0] - origin.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const oy = (raw.origin[1] - origin.lat) * M_PER_DEG_LAT;
  const flat = (a: number[]) => {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 2) {
      out[i] = ox + a[i] * kx;
      out[i + 1] = oy + a[i + 1] * ky;
    }
    return out;
  };
  const rooms = raw.rooms.map((r) => {
    const polygons = r.rings.map((poly) => poly.map(flat));
    // Centroid of the largest outer ring (good enough for a label).
    let best = { a: 0, x: 0, y: 0 };
    for (const poly of polygons) {
      const ring = poly[0];
      let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const f = ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
        a += f;
        cx += (ring[j] + ring[i]) * f;
        cy += (ring[j + 1] + ring[i + 1]) * f;
      }
      if (Math.abs(a) > Math.abs(best.a)) best = { a, x: cx / (3 * a), y: cy / (3 * a) };
    }
    return { id: r.id, name: r.name, label: r.label, use: r.use, kind: r.kind, area: r.area, polygons, centroid: { x: best.x, y: best.y } };
  });
  return {
    id: raw.id,
    origin,
    rooms,
    walls: (raw.lines.wall ?? []).map(flat),
    doors: (raw.lines.door ?? []).map(flat),
    stairs: (raw.lines.stair ?? []).map(flat),
  };
}

export class FloorPlans {
  readonly index: FloorIndex;
  private readonly baseUrl: string;
  private readonly raw = new Map<string, Promise<RawLevel>>();

  constructor(index: FloorIndex, baseUrl: string) {
    this.index = index;
    this.baseUrl = baseUrl;
  }

  static async load(baseUrl = 'floors'): Promise<FloorPlans> {
    const res = await fetch(`${baseUrl}/index.json`);
    if (!res.ok) throw new Error(`floor index: HTTP ${res.status} (run scraper/extract_floors.py)`);
    return new FloorPlans((await res.json()) as FloorIndex, baseUrl);
  }

  level(id: string): LevelSummary | undefined {
    return this.index.levels.find((l) => l.id === id);
  }

  facility(id: string): FacilitySummary | undefined {
    return this.index.facilities.find((f) => f.id === id);
  }

  levelsOf(facilityId: string): LevelSummary[] {
    return this.index.levels.filter((l) => l.facilityId === facilityId).sort((a, b) => a.floor - b.floor);
  }

  async plan(levelId: string, origin: LngLat): Promise<LevelPlan> {
    let raw = this.raw.get(levelId);
    if (!raw) {
      raw = fetch(`${this.baseUrl}/levels/${levelId}.json`).then((r) => {
        if (!r.ok) throw new Error(`level ${levelId}: HTTP ${r.status}`);
        return r.json() as Promise<RawLevel>;
      });
      this.raw.set(levelId, raw);
      raw.catch(() => this.raw.delete(levelId));
    }
    return decodeLevel(await raw, origin);
  }
}

/** Fill colours by room kind (shared by the 2D map and the AR overlay). */
export const KIND_COLORS: Record<string, string> = {
  library: '#b07cc6',
  teaching: '#5b8def',
  study: '#4fb6a8',
  office: '#c9c3b6',
  lab: '#d9a44f',
  circulation: '#f2efe6',
  stairs: '#9aa3ad',
  sanitary: '#8cc6e8',
  food: '#e88c6a',
  outdoor: '#a8d08d',
  service: '#b5b5b5',
  other: '#dedad2',
};
