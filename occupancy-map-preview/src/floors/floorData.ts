import type { MultiPolygon } from 'geojson';

// Floor plans extracted from ETH PolyMaps by scraper/extract_floors.py and
// served as static files from public/floors/. The index is small and loaded
// once; each level's rooms and walls are fetched on demand.

export type RoomKind =
  | 'library' | 'teaching' | 'study' | 'office' | 'lab' | 'circulation'
  | 'stairs' | 'sanitary' | 'food' | 'outdoor' | 'service' | 'other';

export type LineLayer = 'wall' | 'door' | 'stair';

export interface LevelInfo {
  id: string;
  facilityId: string;
  /** Level name inside the building, e.g. "H". */
  name: string;
  /** Vertical order across the site, 0 = ground floor. */
  floor: number;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  outline: MultiPolygon;
}

export interface FacilityInfo {
  id: string;
  name: string;
  address: string | null;
  outline: MultiPolygon;
}

export interface FloorIndex {
  generatedAt: string;
  floors: number[];
  levels: LevelInfo[];
  facilities: FacilityInfo[];
}

/** One room, with rings decoded to Leaflet [lat, lng] tuples. */
export interface Room {
  id: string;
  name: string;
  label: string | null;
  use: string;
  kind: RoomKind;
  area: number;
  /** polygons → rings → [lat, lng] */
  rings: [number, number][][][];
}

export interface LevelPlan {
  id: string;
  rooms: Room[];
  lines: Partial<Record<LineLayer, [number, number][][]>>;
}

interface RawLevel {
  id: string;
  origin: [number, number];
  scale: number;
  rooms: (Omit<Room, 'rings'> & { rings: number[][][] })[];
  lines: Partial<Record<LineLayer, number[][]>>;
}

const BASE = `${import.meta.env.BASE_URL}floors`;

let indexPromise: Promise<FloorIndex> | null = null;
const levelCache = new Map<string, Promise<LevelPlan>>();

export function loadFloorIndex(): Promise<FloorIndex> {
  indexPromise ??= fetchJson<FloorIndex>(`${BASE}/index.json`).catch((err) => {
    indexPromise = null;
    throw err;
  });
  return indexPromise;
}

export function loadLevel(id: string): Promise<LevelPlan> {
  let plan = levelCache.get(id);
  if (!plan) {
    plan = fetchJson<RawLevel>(`${BASE}/levels/${encodeURIComponent(id)}.json`).then(decodeLevel);
    plan.catch(() => levelCache.delete(id));
    levelCache.set(id, plan);
  }
  return plan;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Flat micro-degree offsets [x0, y0, x1, y1, …] → [[lat, lng], …]. */
function decodeLevel(raw: RawLevel): LevelPlan {
  const [lng0, lat0] = raw.origin;
  const decode = (flat: number[]) => {
    const out: [number, number][] = [];
    for (let i = 0; i < flat.length; i += 2) out.push([lat0 + flat[i + 1] / raw.scale, lng0 + flat[i] / raw.scale]);
    return out;
  };
  const lines: LevelPlan['lines'] = {};
  for (const [layer, list] of Object.entries(raw.lines) as [LineLayer, number[][]][]) {
    lines[layer] = list.map(decode);
  }
  return {
    id: raw.id,
    rooms: raw.rooms.map((r) => ({ ...r, rings: r.rings.map((poly) => poly.map(decode)) })),
    lines,
  };
}

/** Human floor label: 0 → "EG", 1 → "1", -1 → "U1". */
export const floorLabel = (floor: number) => (floor === 0 ? 'EG' : floor > 0 ? String(floor) : `U${-floor}`);

export const intersects = (b: LevelInfo['bbox'], view: { west: number; south: number; east: number; north: number }) =>
  b[0] <= view.east && b[2] >= view.west && b[1] <= view.north && b[3] >= view.south;

/** "ETH.HG.H" → "HG H" */
export const levelName = (levelId: string) => levelId.replace(/^ETH\./, '').replace('.', ' ');

/** "ETH.HG.H.H_030.1" → "HG H 30.1" */
export function roomName(unitId: string) {
  const [, building, , ...room] = unitId.split('.');
  return `${building} ${room.join('.').replace(/_0*(?=\d)/, ' ')}`;
}
