import L from 'leaflet';
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

/** Colors of the live room occupancy mode; used in both render modes. */
export interface OccupancyStyle {
  free: string;
  soon: string;
  busy: string;
  closed: string;
  unknown: string;
  /** Fill opacity of a colored room. */
  fill: number;
  /** Room outline width in px (0 = none). */
  weight: number;
  /** Outline of the room whose details are open. */
  selected: string;
}

/** The 3D view: every floor of the buildings stacked, the selected one solid, the others as faint ghosts. */
export interface View3DStyle {
  /** Vertical distance between two floors, in meters on the map (exaggerated storeys read better). */
  spacing: number;
  /** Floors drawn above and below the selected one. */
  range: number;
  /** Opacity of the floors next to the selected one. */
  ghostOpacity: number;
  /** Each further floor keeps this share of the previous one's opacity. */
  falloff: number;
  /** Draw the floors above the selected one (they lie over it). */
  showAbove: boolean;
  /** Walls, doors and stairs on the other floors (only when zoomed in far enough for them). */
  ghostLines: boolean;
  /** Floor letters next to each building's floors. */
  floorLabels: boolean;
  /** Outline around each whole building, from its lowest to its highest floor. */
  shell: boolean;
  shellColor: string;
  /** Shell stroke width in px. */
  shellWeight: number;
  shellOpacity: number;
  /** Shell fill opacity (0 = outline only). */
  shellFill: number;
  /** Outline of the top floor (the roof edge), drawn over the stack. */
  roof: boolean;
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
  /** Structures whose diameter is below this many meters are left out (0 = keep all). Workspaces are always kept. */
  minSize: number;
  /** Nearly parallel line segments closer than this many meters are merged into one (0 = off). */
  mergeDistance: number;
  /** Largest angle in degrees between two segments that still counts as parallel for merging. */
  mergeAngle: number;
  /** Round stroke joins and caps. */
  roundJoins: boolean;
  /** Selected workspace: extra stroke width in px. */
  highlightWidth: number;
  /** Selected workspace: extra fill opacity. */
  highlightFill: number;
  /** Selected workspace: use `highlightColor` instead of the normal color. */
  highlightCustomColor: boolean;
  highlightColor: string;
  occupancy: OccupancyStyle;
  view3d: View3DStyle;
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

const view3d = (shellColor: string): View3DStyle => ({
  spacing: 7,
  range: 6,
  ghostOpacity: 0.12,
  falloff: 0.75,
  showAbove: true,
  ghostLines: true,
  floorLabels: true,
  shell: true,
  shellColor,
  shellWeight: 1.2,
  shellOpacity: 0.7,
  shellFill: 0.06,
  roof: true,
});

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
    minSize: 0,
    mergeDistance: 0,
    mergeAngle: 5,
    roundJoins: true,
    highlightWidth: 1,
    highlightFill: 0.12,
    highlightCustomColor: false,
    highlightColor: '#e8590c',
    occupancy: { free: '#2e9d5b', soon: '#e0a020', busy: '#d0453c', closed: '#8a94a3', unknown: '#c3cad4', fill: 0.45, weight: 0.8, selected: '#1c2430' },
    view3d: view3d('#5a6372'),
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
    minSize: 0,
    mergeDistance: 0,
    mergeAngle: 5,
    roundJoins: true,
    highlightWidth: 1,
    highlightFill: 0.15,
    highlightCustomColor: false,
    highlightColor: '#ffa94d',
    occupancy: { free: '#3fbf74', soon: '#f0b43a', busy: '#ef5f55', closed: '#6d7788', unknown: '#3d4553', fill: 0.5, weight: 0.8, selected: '#ffffff' },
    view3d: view3d('#8792a5'),
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
    out[theme] = { ...out[theme], ...s, parts: { ...out[theme].parts }, occupancy: { ...base[theme].occupancy, ...s.occupancy }, view3d: { ...base[theme].view3d, ...s.view3d } };
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

// ---- small structures --------------------------------------------------------

/** True when no two points of `path` are `min` meters or more apart, i.e. its diameter is below `min`. */
function smallerThan(path: In[], min: number): boolean {
  if (!path.length) return true;
  const kx = M_PER_DEG_LAT * Math.cos((path[0][0] * Math.PI) / 180);
  const m2 = min * min;
  for (let i = 0; i < path.length; i++) {
    for (let j = i + 1; j < path.length; j++) {
      const dx = (path[j][1] - path[i][1]) * kx;
      const dy = (path[j][0] - path[i][0]) * M_PER_DEG_LAT;
      if (dx * dx + dy * dy >= m2) return false;
    }
  }
  return true;
}

/** Whether a structure made of polygons (→ rings, outer ring first) has a diameter below `min` meters. */
export const polygonsSmallerThan = (polys: In[][][], min: number): boolean =>
  min > 0 && smallerThan(polys.flatMap((rings) => rings[0] ?? []), min);

/** Open polylines without the ones whose diameter is below `min` meters. */
export const dropSmallLines = (lines: In[][], min: number): In[][] =>
  min <= 0 ? lines : lines.filter((line) => !smallerThan(line, min));

// ---- simplification ----------------------------------------------------------

/** Meters covered by one screen px at `zoom` (Web Mercator, 256 px tiles) at latitude `lat`. */
export const metersPerPixel = (lat: number, zoom: number): number =>
  (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom);

/**
 * Leaflet's own path simplification (what `smoothFactor` does at draw time), but
 * with the tolerance in meters, so steps that need the simplified lines, like
 * merging parallel edges, can run after it.
 */
export function simplifyLines(lines: In[][], tolerance: number): In[][] {
  const origin = lines.find((l) => l.length)?.[0];
  if (tolerance <= 0 || !origin) return lines;
  const kx = M_PER_DEG_LAT * Math.cos((origin[0] * Math.PI) / 180);
  return lines.map((line) =>
    L.LineUtil.simplify(
      line.map(([lat, lng]) => L.point(lng * kx, lat * M_PER_DEG_LAT)),
      tolerance,
    ).map((p): In => [p.y / M_PER_DEG_LAT, p.x / kx]),
  );
}

// ---- parallel edge merging ---------------------------------------------------

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  len: number;
  /** Unit direction a → b. */
  ux: number;
  uy: number;
}

/**
 * Merges nearly parallel segments of `lines` into one segment per group, like a
 * simplify step that works on edges instead of vertices. Two segments group when
 * their directions differ by at most `maxAngle` degrees and the shorter one lies
 * within `distance` meters of the longer one, sideways and along it (groups
 * chain). The merged segment runs through the group's length-weighted centroid
 * along its length-weighted mean direction, so it keeps the rotation of the
 * originals, and spans every original endpoint projected onto it, so it covers
 * the longest way. Runs of segments without a partner keep their polylines.
 */
export function mergeParallelEdges(lines: In[][], distance: number, maxAngle: number): In[][] {
  const origin = lines.find((l) => l.length)?.[0];
  if (distance <= 0 || !origin) return lines;
  const kx = M_PER_DEG_LAT * Math.cos((origin[0] * Math.PI) / 180);
  const toM = ([lat, lng]: In): Pt => [lng * kx, lat * M_PER_DEG_LAT];
  const toLatLng = (x: number, y: number): In => [y / M_PER_DEG_LAT, x / kx];
  const cosTol = Math.cos((Math.min(maxAngle, 89) * Math.PI) / 180);

  // Segments in local meters; segOf[line][k] is the index of segment k → k+1, -1 when degenerate.
  const segs: Seg[] = [];
  const segOf = lines.map((line) => {
    const ids: number[] = [];
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, ay] = toM(line[k]);
      const [bx, by] = toM(line[k + 1]);
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-3) {
        ids.push(-1);
        continue;
      }
      ids.push(segs.length);
      segs.push({ ax, ay, bx, by, len, ux: (bx - ax) / len, uy: (by - ay) / len });
    }
    return ids;
  });

  const parent = segs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  const near = (p: Seg, q: Seg) => {
    if (Math.abs(p.ux * q.ux + p.uy * q.uy) < cosTol) return false;
    // Measure the shorter segment against the longer one's axis.
    const [l, s] = p.len >= q.len ? [p, q] : [q, p];
    const t = (x: number, y: number) => (x - l.ax) * l.ux + (y - l.ay) * l.uy;
    const off = (x: number, y: number) => Math.abs((y - l.ay) * l.ux - (x - l.ax) * l.uy);
    if (off(s.ax, s.ay) > distance || off(s.bx, s.by) > distance) return false;
    const t1 = t(s.ax, s.ay);
    const t2 = t(s.bx, s.by);
    return Math.max(Math.min(t1, t2) - l.len, -Math.max(t1, t2)) <= distance;
  };

  // Sweep along x so only segments with overlapping (padded) boxes are compared.
  const box = segs.map((g) => ({
    x0: Math.min(g.ax, g.bx),
    x1: Math.max(g.ax, g.bx),
    y0: Math.min(g.ay, g.by),
    y1: Math.max(g.ay, g.by),
  }));
  const order = segs.map((_, i) => i).sort((i, j) => box[i].x0 - box[j].x0);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      if (box[j].x0 > box[i].x1 + distance) break;
      if (box[j].y0 > box[i].y1 + distance || box[i].y0 > box[j].y1 + distance) continue;
      if (find(i) !== find(j) && near(segs[i], segs[j])) parent[find(i)] = find(j);
    }
  }

  const groups = new Map<number, number[]>();
  segs.forEach((_, i) => {
    const root = find(i);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(i);
  });

  const mergedLine = (members: number[]): In[] => {
    // Directions are undirected, so average the doubled angles.
    let c2 = 0, s2 = 0, cx = 0, cy = 0, w = 0;
    for (const i of members) {
      const g = segs[i];
      const a = 2 * Math.atan2(g.uy, g.ux);
      c2 += g.len * Math.cos(a);
      s2 += g.len * Math.sin(a);
      cx += (g.len * (g.ax + g.bx)) / 2;
      cy += (g.len * (g.ay + g.by)) / 2;
      w += g.len;
    }
    const theta = Math.atan2(s2, c2) / 2;
    const ux = Math.cos(theta), uy = Math.sin(theta);
    cx /= w;
    cy /= w;
    let lo = Infinity, hi = -Infinity;
    for (const i of members) {
      const g = segs[i];
      for (const [x, y] of [[g.ax, g.ay], [g.bx, g.by]]) {
        const t = (x - cx) * ux + (y - cy) * uy;
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    }
    return [toLatLng(cx + ux * lo, cy + uy * lo), toLatLng(cx + ux * hi, cy + uy * hi)];
  };

  const out: In[][] = [];
  const emitted = new Set<number>();
  lines.forEach((line, li) => {
    let run: In[] = [];
    const flush = () => {
      if (run.length >= 2) out.push(run);
      run = [];
    };
    segOf[li].forEach((si, k) => {
      const members = si < 0 ? null : groups.get(find(si))!;
      if (!members || members.length === 1) {
        if (!run.length) run.push(line[k]);
        run.push(line[k + 1]);
        return;
      }
      flush();
      const root = find(si);
      if (!emitted.has(root)) {
        emitted.add(root);
        out.push(mergedLine(members));
      }
    });
    flush();
    if (line.length === 1) out.push(line);
  });
  return out;
}
