import type { Library } from './domain/types';
import { readStored, writeStored } from './storage';

/**
 * What the map shows, picked with the slider behind the layers button:
 * - `study`: only the workspaces of the bookable study spaces (the home screen's)
 * - `workspaces`: every workspace, with live rooms
 * - `campus`: every workspace, live rooms, ASVZ sport and mensas
 * The 3D floor stack has its own switch in the same sheet; everything else
 * the map can do stays off.
 */
export type MapMode = 'study' | 'workspaces' | 'campus';

export const MAP_MODES: MapMode[] = ['study', 'workspaces', 'campus'];

export const MAP_MODE_LABELS: Record<MapMode, { label: string; hint: string }> =
  {
    study: {
      label: 'Study spaces',
      hint: 'Bookable study spaces',
    },
    workspaces: {
      label: 'Workspaces',
      hint: 'All workspaces and lecture rooms',
    },
    campus: {
      label: 'Campus',
      hint: 'Everything in Workspaces, plus ASVZ sport and the mensas',
    },
  };

/** The campus datasets each mode switches on. */
export const MODE_DATASETS: Record<MapMode, string[]> = {
  study: [],
  workspaces: [],
  campus: ['asvz', 'mensa'],
};

const localMap = ['localhost', '127.0.0.1', '[::1]'].includes(
  globalThis.location?.hostname ?? '',
);
// Keep the pitch's local preference separate from the hosted app's setting.
const mapModeKey = localMap ? 'map-mode-local' : 'map-mode';

export function loadMapMode(): MapMode {
  const stored = readStored(mapModeKey);
  return (
    MAP_MODES.find((m) => m === stored) ?? (localMap ? 'workspaces' : 'study')
  );
}

export function saveMapMode(mode: MapMode) {
  writeStored(mapModeKey, mode);
}

/** The 3D floor stack: on unless switched off. */
export function load3d(): boolean {
  return readStored('view-3d') !== '0';
}

export function save3d(on: boolean) {
  writeStored('view-3d', on ? '1' : '0');
}

/** A bookable study space, as the reservations API lists it. */
export interface BookableSpace {
  id: string;
  name: string;
  /** The PolyMaps room (unit) the space is in, e.g. "ETH.HG.E.E_051". */
  map_room_id: string;
  lat: number;
  lng: number;
}

/** A workspace this far (m) from a study space still counts as its place. */
const NEAR_METERS = 60;
/** A workspace named like the study space counts up to this far (m), within one campus. */
const NAMED_METERS = 500;

/** Rough distance in meters, good enough within a campus. */
function meters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** Lowercase letters and digits only, for comparing names. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöü]/g, '');

/**
 * The workspaces of the bookable study spaces: workspace id → study space id.
 * A space's place is the workspace that contains its map room, else the closest
 * workspace nearby whose name (or id) shares a part of the space's name, else
 * the closest workspace within NEAR_METERS.
 */
export function bookableLibraries(
  spaces: BookableSpace[],
  libraries: Library[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const space of spaces) {
    const containing = libraries.find((lib) =>
      lib.rooms.includes(space.map_room_id),
    );
    if (containing) {
      out.set(containing.id, space.id);
      continue;
    }
    const parts = space.name
      .replace(/^demo:/i, '')
      .split('/')
      .map(squash)
      .filter((p) => p.length >= 4);
    const byDistance = libraries
      .map((lib) => ({ lib, d: meters(space, lib.position) }))
      .sort((a, b) => a.d - b.d);
    const named = byDistance.find(
      ({ lib, d }) =>
        d <= NAMED_METERS &&
        parts.some(
          (p) => squash(lib.name).includes(p) || squash(lib.id).includes(p),
        ),
    );
    const nearest = byDistance[0];
    const match =
      named ?? (nearest && nearest.d <= NEAR_METERS ? nearest : undefined);
    if (match && !out.has(match.lib.id)) out.set(match.lib.id, space.id);
  }
  return out;
}
