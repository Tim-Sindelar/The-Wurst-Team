import type L from 'leaflet';
import type { RoomKind } from '../floors/floorData';
import type { Theme } from './FloorLayer';

// Settings for the "minimal" render mode: a label-free basemap and only the
// outlines picked in the style panel. Everything here is applied on the
// client, so the sliders update the map live; once a look is settled, the
// geometry steps (corner rounding) could be baked into extract_floors.py.

export type RenderMode = 'detailed' | 'minimal';

/** Outline groups the minimal mode can draw, top to bottom in the panel. */
export type PartKey = 'workspaces' | 'libraryRooms' | 'levels' | 'buildings' | 'rooms' | 'walls' | 'doors' | 'stairs';

export interface PartStyle {
  show: boolean;
  color: string;
  /** Stroke width in px. */
  weight: number;
  opacity: number;
  /** Fill opacity, polygons only (0 = outline only). */
  fill: number;
  fillColor: string;
}

export interface MinimalStyle {
  basemapLabels: boolean;
  /** 0 hides the basemap, leaving only the plain map background. */
  basemapOpacity: number;
  parts: Record<PartKey, PartStyle>;
  /** Room kinds whose outlines the "rooms" part draws. */
  roomKinds: RoomKind[];
  /** Workspace outlines colored by occupancy instead of their part color. */
  occupancyColors: boolean;
  /** Corner rounding radius in meters (0 = sharp). */
  cornerRadius: number;
  /** Leaflet smoothFactor: path simplification in screen px. */
  simplify: number;
  /** Round stroke joins and caps. */
  roundJoins: boolean;
  /** Selected workspace: extra stroke width in px. */
  highlightWidth: number;
  /** Selected workspace: extra fill opacity. */
  highlightFill: number;
  /** Selected workspace: use `highlightColor` instead of the normal color. */
  highlightCustomColor: boolean;
  highlightColor: string;
}

export const PART_LABELS: Record<PartKey, { label: string; polygon: boolean }> = {
  workspaces: { label: 'Workspace outlines', polygon: true },
  libraryRooms: { label: 'Workspace rooms', polygon: true },
  levels: { label: 'Floor outline', polygon: true },
  buildings: { label: 'Building footprints', polygon: true },
  rooms: { label: 'Other rooms', polygon: true },
  walls: { label: 'Walls', polygon: false },
  doors: { label: 'Doors', polygon: false },
  stairs: { label: 'Stairs', polygon: false },
};

export const ROOM_KINDS: RoomKind[] = [
  'teaching', 'study', 'office', 'lab', 'circulation', 'stairs', 'sanitary', 'food', 'outdoor', 'service', 'other',
];

const part = (show: boolean, color: string, weight: number, fill = 0, fillColor = color, opacity = 1): PartStyle =>
  ({ show, color, weight, opacity, fill, fillColor });

export const DEFAULT_MINIMAL: Record<Theme, MinimalStyle> = {
  light: {
    basemapLabels: false,
    basemapOpacity: 0.6,
    parts: {
      workspaces: part(true, '#215caf', 2.5, 0.12),
      libraryRooms: part(true, '#215caf', 1, 0.25),
      levels: part(true, '#5a6372', 1.5, 0.9, '#fbfbfc'),
      buildings: part(true, '#b9c0cb', 1, 0.5, '#dfe3ea'),
      rooms: part(false, '#c3cad4', 0.6, 0),
      walls: part(false, '#3c4450', 1, 0, undefined, 0.8),
      doors: part(false, '#8a94a3', 0.8),
      stairs: part(false, '#9aa3ae', 0.6),
    },
    roomKinds: ['teaching', 'study', 'circulation', 'stairs'],
    occupancyColors: true,
    cornerRadius: 0,
    simplify: 1,
    roundJoins: true,
    highlightWidth: 1,
    highlightFill: 0.12,
    highlightCustomColor: false,
    highlightColor: '#e8590c',
  },
  dark: {
    basemapLabels: false,
    basemapOpacity: 0.5,
    parts: {
      workspaces: part(true, '#4c8dff', 2.5, 0.15),
      libraryRooms: part(true, '#4c8dff', 1, 0.3),
      levels: part(true, '#8792a5', 1.5, 0.9, '#1e232c'),
      buildings: part(true, '#3d4553', 1, 0.6, '#2a303b'),
      rooms: part(false, '#3d4553', 0.6, 0),
      walls: part(false, '#aab3c2', 1, 0, undefined, 0.8),
      doors: part(false, '#6d7788', 0.8),
      stairs: part(false, '#5b6474', 0.6),
    },
    roomKinds: ['teaching', 'study', 'circulation', 'stairs'],
    occupancyColors: true,
    cornerRadius: 0,
    simplify: 1,
    roundJoins: true,
    highlightWidth: 1,
    highlightFill: 0.15,
    highlightCustomColor: false,
    highlightColor: '#ffa94d',
  },
};

export type MinimalStyles = Record<Theme, MinimalStyle>;
type PartialStyles = Partial<Record<Theme, Partial<MinimalStyle>>>;

// Two layers over the built-in defaults: the standard in data/map-style.json
// (shared, written by "Save as standard") and this browser's unsaved tweaks
// in localStorage. Tweaks win; saving a standard clears them.
const STORAGE_KEY = 'minimal-style';
const STANDARD_URL = `${import.meta.env.VITE_API_BASE ?? '/api'}/map-style`;

/** `over` merged field by field onto `base`, so fields added later keep their default. */
function mergeStyles(base: MinimalStyles, over: PartialStyles | null): MinimalStyles {
  const out = structuredClone(base);
  for (const theme of ['light', 'dark'] as const) {
    const s = over?.[theme];
    if (!s) continue;
    out[theme] = { ...out[theme], ...s, parts: { ...out[theme].parts } };
    for (const key of Object.keys(out[theme].parts) as PartKey[]) {
      out[theme].parts[key] = { ...base[theme].parts[key], ...s.parts?.[key] };
    }
  }
  return out;
}

function localTweaks(): PartialStyles | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/** The standard (built-in defaults until loaded) with this browser's tweaks on top. */
export const loadMinimalStyles = (standard: MinimalStyles = DEFAULT_MINIMAL): MinimalStyles => mergeStyles(standard, localTweaks());

/** The saved standard over the built-in defaults; the built-ins when none is saved. */
export async function fetchStandardStyles(): Promise<MinimalStyles> {
  const res = await fetch(STANDARD_URL, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return DEFAULT_MINIMAL;
  if (!res.ok) throw new Error(`Loading map style failed: ${res.status} ${await res.text()}`);
  return mergeStyles(DEFAULT_MINIMAL, await res.json());
}

/** Writes data/map-style.json and drops the local tweaks, which now equal the standard. */
export async function saveStandardStyles(styles: MinimalStyles): Promise<void> {
  const res = await fetch(STANDARD_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(styles),
  });
  if (!res.ok) throw new Error(`Saving map style failed: ${res.status} ${await res.text()}`);
  clearLocalTweaks();
}

/** Drops this browser's tweaks for one theme, or for both. */
export function clearLocalTweaks(theme?: Theme) {
  try {
    const rest = theme ? { ...localTweaks() } : {};
    if (theme) delete rest[theme];
    if (Object.keys(rest).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Remembers an edited theme style in this browser (the other theme keeps following the standard). */
export function saveLocalTweak(theme: Theme, style: MinimalStyle) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...localTweaks(), [theme]: style }));
  } catch {}
}

/** Leaflet path options for one part. */
export function partPathOptions(s: MinimalStyle, key: PartKey): L.PolylineOptions {
  const p = s.parts[key];
  return {
    color: p.color,
    weight: p.weight,
    opacity: p.opacity,
    fill: PART_LABELS[key].polygon && p.fill > 0,
    fillColor: p.fillColor,
    fillOpacity: p.fill,
    lineJoin: s.roundJoins ? 'round' : 'miter',
    lineCap: s.roundJoins ? 'round' : 'butt',
    smoothFactor: s.simplify,
  };
}

// ---- corner rounding ---------------------------------------------------------

type Pt = [number, number];
type In = L.LatLngTuple;
const M_PER_DEG_LAT = 110_574;
const ARC_STEPS = 4;

/**
 * Replaces every corner of a [lat, lng] path with a quadratic curve that starts
 * and ends `radius` meters from the corner (less on short edges, at most half
 * of each). Unlike Chaikin smoothing this keeps long straight walls straight
 * and only touches the corners, so it reads like rounded architecture rather
 * than blobs. Rings are open (Leaflet style); `closed` rounds the seam too.
 */
export function roundCorners(path: In[], radius: number, closed: boolean): In[] {
  if (radius <= 0 || path.length < 3) return path;
  const kx = M_PER_DEG_LAT * Math.cos((path[0][0] * Math.PI) / 180);
  // Work in local meters (x east, y north); drop repeated vertices.
  const pts: Pt[] = [];
  for (const [lat, lng] of path) {
    const p: Pt = [lng * kx, lat * M_PER_DEG_LAT];
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-4) pts.push(p);
  }
  if (closed && pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-4) pts.pop();
  const n = pts.length;
  if (n < 3) return path;

  const out: Pt[] = [];
  const emit = (x: number, y: number) => out.push([y / M_PER_DEG_LAT, x / kx]);
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    if (!closed && (i === 0 || i === n - 1)) {
      emit(cur[0], cur[1]);
      continue;
    }
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const d1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const d2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    // Nearly straight vertices don't need a curve.
    const cross = Math.abs((cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0])) / (d1 * d2);
    if (r < 0.01 || cross < 0.02) {
      emit(cur[0], cur[1]);
      continue;
    }
    const a: Pt = [cur[0] + ((prev[0] - cur[0]) * r) / d1, cur[1] + ((prev[1] - cur[1]) * r) / d1];
    const b: Pt = [cur[0] + ((next[0] - cur[0]) * r) / d2, cur[1] + ((next[1] - cur[1]) * r) / d2];
    for (let s = 0; s <= ARC_STEPS; s++) {
      const t = s / ARC_STEPS;
      const u = 1 - t;
      emit(u * u * a[0] + 2 * u * t * cur[0] + t * t * b[0], u * u * a[1] + 2 * u * t * cur[1] + t * t * b[1]);
    }
  }
  return out;
}

/** roundCorners over polygons → rings. */
export const roundPolygons = (polys: In[][][], radius: number): In[][][] =>
  radius <= 0 ? polys : polys.map((rings) => rings.map((ring) => roundCorners(ring, radius, true)));

/** roundCorners over open polylines. */
export const roundLines = (lines: In[][], radius: number): In[][] =>
  radius <= 0 ? lines : lines.map((line) => roundCorners(line, radius, false));
