import type { MultiPolygon } from 'geojson';
import polygonClipping from 'polygon-clipping';
import { MAP_API } from '../data/api';

// Floor plans extracted from ETH PolyMaps by scraper/extract_floors.py and
// served as static files by the backend (/api/v1/map/floors). The index is small and loaded
// once; each level's rooms and walls are fetched on demand.

export type RoomKind =
  | 'library'
  | 'teaching'
  | 'study'
  | 'office'
  | 'lab'
  | 'circulation'
  | 'stairs'
  | 'sanitary'
  | 'food'
  | 'outdoor'
  | 'service'
  | 'other';

export type LineLayer = 'wall' | 'door' | 'stair';

export interface LevelInfo {
  id: string;
  facilityId: string;
  /** Level name inside the building, e.g. "H". */
  name: string;
  /** Floor letter shown to users ("H", "FO" = intermediate floor). Letters are per building, not site-wide. */
  label: string;
  /** Floor number, 0 = the building's ground floor, counted in storeys from the floor letters of its room names (intermediate floors join their base floor). */
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

const BASE = `${MAP_API}/floors`;

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
    plan = fetchJson<RawLevel>(
      `${BASE}/levels/${encodeURIComponent(id)}.json`,
    ).then(decodeLevel);
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
    for (let i = 0; i < flat.length; i += 2)
      out.push([lat0 + flat[i + 1] / raw.scale, lng0 + flat[i] / raw.scale]);
    return out;
  };
  const lines: LevelPlan['lines'] = {};
  for (const [layer, list] of Object.entries(raw.lines) as [
    LineLayer,
    number[][],
  ][]) {
    lines[layer] = list.map(decode);
  }
  return {
    id: raw.id,
    rooms: raw.rooms.map((r) => ({
      ...r,
      rings: r.rings.map((poly) => poly.map(decode)),
    })),
    lines,
  };
}

/** Floor letter of a level: "ETH.CAB.FO" → "FO". Same letter as LevelInfo.label. */
export const levelLabel = (levelId: string) =>
  levelId.slice(levelId.lastIndexOf('.') + 1);

/** Legacy lists can show the combined letters on a native floor number. */
export function floorLabel(floor: number, levels: LevelInfo[]) {
  const labels = [
    ...new Set(levels.filter((l) => l.floor === floor).map((l) => l.label)),
  ].sort();
  return labels.length > 3
    ? labels.slice(0, 2).join('/') + '…'
    : labels.join('/') || String(floor);
}

/** One floor letter: an intermediate floor ("FO") counts as its base floor ("F"). */
export const baseLetter = (label: string) =>
  label.length > 1 && label.endsWith('O') ? label.slice(0, -1) : label;

/**
 * The building to name the floors after: the one whose level outlines hold the
 * point, else the nearest one. Null without levels.
 */
export function focusFacility(
  levels: LevelInfo[],
  lat: number,
  lng: number,
): string | null {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best: string | null = null;
  let bestD = Infinity;
  for (const l of levels) {
    const [w, s, e, n] = l.bbox;
    const dx = Math.max(w - lng, 0, lng - e) * kx;
    const dy = Math.max(s - lat, 0, lat - n);
    // Inside several boxes: the smaller box is the closer fit.
    const d =
      dx === 0 && dy === 0 ? -1 / ((e - w) * kx * (n - s)) : Math.hypot(dx, dy);
    if (d < bestD) [best, bestD] = [l.facilityId, d];
  }
  return best;
}

/**
 * A single floor letter for a floor number: the letter the building in focus
 * uses for it, else the one most buildings among `levels` use. Floor numbers
 * stay as they are (per building, from the room names); only the label is
 * picked, since buildings letter the same storey differently.
 */
export function singleFloorLabel(
  floor: number,
  levels: LevelInfo[],
  focus: string | null,
): string {
  const on = levels.filter((l) => l.floor === floor);
  const own = on.find((l) => l.facilityId === focus);
  if (own) return baseLetter(own.label);
  const votes = new Map<string, number>();
  for (const l of on) {
    const letter = baseLetter(l.label);
    votes.set(letter, (votes.get(letter) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestVotes = 0;
  for (const [letter, n] of [...votes].sort(([a], [b]) => a.localeCompare(b)))
    if (n > bestVotes) [best, bestVotes] = [letter, n];
  return best ?? String(floor);
}

/** Floor letter shown for a library: its level's letter, else its building's letter for its floor (needs the index). */
export const libraryFloorLabel = (
  lib: { floor: number; levelId?: string | null; facilityId?: string | null },
  levels: LevelInfo[] = [],
) =>
  lib.levelId
    ? baseLetter(levelLabel(lib.levelId))
    : singleFloorLabel(lib.floor, levels, lib.facilityId ?? null);

export const intersects = (
  b: LevelInfo['bbox'],
  view: { west: number; south: number; east: number; north: number },
) =>
  b[0] <= view.east &&
  b[2] >= view.west &&
  b[1] <= view.north &&
  b[3] >= view.south;

/** "ETH.HG.H" → "HG H" */
export const levelName = (levelId: string) =>
  levelId.replace(/^ETH\./, '').replace('.', ' ');

/** "ETH.HG.H.H_030.1" → "HG H 30.1" */
export function roomName(unitId: string) {
  const [, building, , ...room] = unitId.split('.');
  return `${building} ${room.join('.').replace(/_0*(?=\d)/, ' ')}`;
}

type RawOutlines = Record<string, MultiPolygon & { rooms?: string[] }>;
let rawOutlinesPromise: Promise<RawOutlines> | null = null;
let outlinesPromise: Promise<Record<string, MultiPolygon>> | null = null;
const loadRawOutlines = () =>
  (rawOutlinesPromise ??= fetchJson<RawOutlines>(
    `${BASE}/library-outlines.json`,
  ).catch(() => ({})));

/** The file holds one polygon per room; overlapping or touching rooms of a workspace become one shape. */
function mergeOutlines(
  outlines: Record<string, MultiPolygon>,
): Record<string, MultiPolygon> {
  const out: Record<string, MultiPolygon> = {};
  for (const [id, mp] of Object.entries(outlines)) {
    try {
      const [first, ...rest] = mp.coordinates as polygonClipping.Geom[];
      out[id] = {
        type: 'MultiPolygon',
        coordinates: polygonClipping.union(
          first,
          ...rest,
        ) as MultiPolygon['coordinates'],
      };
    } catch {
      out[id] = mp;
    }
  }
  return out;
}

/** Library outlines derived from their rooms by scraper/build_library_outlines.py (empty if not generated). */
export function loadLibraryOutlines(): Promise<Record<string, MultiPolygon>> {
  outlinesPromise ??= loadRawOutlines().then(mergeOutlines);
  return outlinesPromise;
}

/** The rooms (sorted ids joined by "|") each pregenerated outline was built from. */
export const roomsKey = (rooms: string[]) => [...rooms].sort().join('|');
export async function loadLibraryOutlineRoomKeys(): Promise<
  Record<string, string>
> {
  const raw = await loadRawOutlines();
  return Object.fromEntries(
    Object.entries(raw).map(([id, o]) => [id, roomsKey(o.rooms ?? [])]),
  );
}

const roomOutlineCache = new Map<
  string,
  Promise<Record<string, polygonClipping.Geom>>
>();
const loadRoomOutlines = (levelId: string) => {
  let p = roomOutlineCache.get(levelId);
  if (!p) {
    p = fetchJson<Record<string, polygonClipping.Geom>>(
      `${BASE}/room-outlines/${encodeURIComponent(levelId)}.json`,
    ).catch(() => ({}));
    roomOutlineCache.set(levelId, p);
  }
  return p;
};

/**
 * Outline of an arbitrary set of rooms (e.g. a workspace made in the admin UI), merged into one shape.
 * Reads the per-level room polygons written by scraper/build_library_outlines.py.
 */
export async function outlineFromRooms(
  roomIds: string[],
): Promise<MultiPolygon | null> {
  const levelIds = [
    ...new Set(roomIds.map((r) => r.split('.').slice(0, 3).join('.'))),
  ];
  const perLevel = await Promise.all(levelIds.map(loadRoomOutlines));
  const polys = roomIds.flatMap((id) =>
    perLevel.flatMap((rooms) => (rooms[id] ?? []) as unknown[]),
  ) as polygonClipping.Polygon[];
  if (!polys.length) return null;
  const [first, ...rest] = polys;
  try {
    return {
      type: 'MultiPolygon',
      coordinates: polygonClipping.union(
        first,
        ...rest,
      ) as MultiPolygon['coordinates'],
    };
  } catch {
    return {
      type: 'MultiPolygon',
      coordinates: polys as MultiPolygon['coordinates'],
    };
  }
}

/** Fetch the exact native room boundary; failures remain retryable in admin. */
export async function loadRoomOutline(roomId: string): Promise<MultiPolygon> {
  const levelId = roomId.split('.').slice(0, 3).join('.');
  const rooms = await loadRoomOutlines(levelId);
  const coordinates = rooms[roomId];
  if (!coordinates?.length) {
    roomOutlineCache.delete(levelId);
    throw new Error(
      'No outline is available for this room. Choose another room.',
    );
  }
  return {
    type: 'MultiPolygon',
    coordinates: coordinates as MultiPolygon['coordinates'],
  };
}
