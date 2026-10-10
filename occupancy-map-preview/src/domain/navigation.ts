import { CAMPUSES, type LatLng, type Library, type MultiPolygon } from './types';
import { checkMultiPolygon } from './validate';

// Click-to-zoom navigation: clicking inside a zone flies the map to it, but
// only while the current zoom is in the zone's active range. It's a shortcut
// on top of normal panning and zooming, configured in admin mode and stored
// in data/navigation.json.

/** Areas are the coarse level (a campus), buildings the finer one. */
export type NavZoneKind = 'area' | 'building';

export interface NavZone {
  id: string;
  name: string;
  kind: NavZoneKind;
  /** Clickable region as GeoJSON ([lng, lat]); null = not drawn yet (inactive). */
  outline: MultiPolygon | null;
  /** Zoom level the map flies to, centered on the outline. */
  zoom: number;
  /** Clickable only while the map is zoomed out further than this (zoom < activeBelowZoom). */
  activeBelowZoom: number;
  /** Clickable only from this zoom on (zoom >= activeFromZoom); null = no lower limit. Used by buildings. */
  activeFromZoom: number | null;
}

export interface NavigationConfig {
  zones: NavZone[];
}

export const NAV_ZONE_DEFAULTS: Record<NavZoneKind, Pick<NavZone, 'zoom' | 'activeBelowZoom' | 'activeFromZoom'>> = {
  area: { zoom: 16, activeBelowZoom: 15, activeFromZoom: null },
  building: { zoom: 18, activeBelowZoom: 18, activeFromZoom: 16 },
};

export const isZoneActive = (zone: NavZone, zoom: number) =>
  zone.outline !== null && zoom < zone.activeBelowZoom && (zone.activeFromZoom === null || zoom >= zone.activeFromZoom);

/** Even-odd ray casting over every ring, so holes are excluded. */
export function outlineContains(outline: MultiPolygon, { lat, lng }: LatLng): boolean {
  return outline.coordinates.some((polygon) => {
    let inside = false;
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  });
}

/** The zone a click at `pos` triggers: buildings win over areas, so nested zones work. */
export function zoneAt(config: NavigationConfig, pos: LatLng, zoom: number): NavZone | null {
  const hits = config.zones.filter((z) => isZoneActive(z, zoom) && outlineContains(z.outline!, pos));
  return hits.find((z) => z.kind === 'building') ?? hits[0] ?? null;
}

export function outlineCenter(outline: MultiPolygon): LatLng {
  let [minLat, minLng, maxLat, maxLng] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of outline.coordinates) {
    for (const [lng, lat] of polygon[0]) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

const rectangle = (south: number, west: number, north: number, east: number): MultiPolygon => ({
  type: 'MultiPolygon',
  coordinates: [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]],
});

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Positions of a campus's workspaces within `km` of their median. */
function campusCluster(libraries: Library[], campus: Library['campus'], km: number): LatLng[] {
  const all = libraries.filter((l) => l.campus === campus).map((l) => l.position);
  if (!all.length) return [];
  const mid = { lat: median(all.map((p) => p.lat)), lng: median(all.map((p) => p.lng)) };
  // A degree of latitude is ~111 km, of longitude ~75 km here.
  return all.filter((p) => Math.hypot((p.lat - mid.lat) * 111, (p.lng - mid.lng) * 75) < km);
}

/**
 * What the start view frames: every workspace (enabled or not) near its
 * campus, so both campuses fit but outposts (Basel, Oerlikon) don't zoom it out.
 */
export const homePositions = (libraries: Library[]): LatLng[] => CAMPUSES.flatMap((c) => campusCluster(libraries, c, 1.5));

/**
 * Used until an admin saves navigation.json: one area per campus around its
 * workspaces within ~1 km of their median (campus tags also cover far-off
 * places, e.g. Oerlikon under Hönggerberg, which would blow the area up).
 */
export function defaultNavigation(libraries: Library[]): NavigationConfig {
  const zones: NavZone[] = [];
  for (const campus of CAMPUSES) {
    const pts = campusCluster(libraries, campus, 1);
    if (!pts.length) continue;
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const pad = 0.001; // ≈ 100 m
    zones.push({
      id: `nav-${campus.toLowerCase().replace(/[^a-z]/g, '')}`,
      name: campus,
      kind: 'area',
      outline: rectangle(Math.min(...lats) - pad, Math.min(...lngs) - pad, Math.max(...lats) + pad, Math.max(...lngs) + pad),
      ...NAV_ZONE_DEFAULTS.area,
    });
  }
  return { zones };
}

export function validateNavigation(input: unknown): string[] {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const isZoom = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 24;
  if (!isObj(input) || !Array.isArray(input.zones)) return ['zones must be an array'];
  const errors: string[] = [];
  const ids = new Set<string>();
  input.zones.forEach((z: unknown, i) => {
    const at = `zones[${i}]`;
    if (!isObj(z) || typeof z.id !== 'string' || typeof z.name !== 'string') return errors.push(`${at}: id and name required`);
    if (ids.has(z.id)) errors.push(`${at}: duplicate id ${z.id}`);
    ids.add(z.id);
    if (z.kind !== 'area' && z.kind !== 'building') errors.push(`${at}: kind must be area or building`);
    if (z.outline !== null) {
      const err = checkMultiPolygon(z.outline);
      if (err) errors.push(`${at}: outline ${err}`);
    }
    if (!isZoom(z.zoom)) errors.push(`${at}: zoom must be a number from 0 to 24`);
    if (!isZoom(z.activeBelowZoom)) errors.push(`${at}: activeBelowZoom must be a number from 0 to 24`);
    if (z.activeFromZoom !== null && !isZoom(z.activeFromZoom)) errors.push(`${at}: activeFromZoom must be null or a number from 0 to 24`);
  });
  return errors;
}
