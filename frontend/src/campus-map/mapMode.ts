import type { Library } from './domain/types';
import {
  roomName,
  type FacilityInfo,
  type LevelInfo,
} from './floors/floorData';
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

export function loadMapMode(): MapMode {
  const stored = readStored('map-mode');
  return MAP_MODES.find((m) => m === stored) ?? 'study';
}

export function saveMapMode(mode: MapMode) {
  writeStored('map-mode', mode);
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

/** The PolyMaps level of a room id ("ETH.HG.F.F_026.3" → "ETH.HG.F"). */
const levelOf = (roomId: string) => roomId.split('.').slice(0, 3).join('.');

/**
 * A workspace for each study space whose map room no enabled workspace
 * contains: the room itself, named like the space, on the room's floor. The
 * map draws its outline from the room, as for workspaces made in admin.
 */
export function spaceWorkspaces(
  spaces: BookableSpace[],
  libraries: Library[],
  levels: LevelInfo[],
  facilities: FacilityInfo[],
): Library[] {
  const covered = new Set(
    libraries.filter((l) => l.enabled).flatMap((l) => l.rooms),
  );
  const out: Library[] = [];
  for (const space of spaces) {
    if (!space.map_room_id || covered.has(space.map_room_id)) continue;
    const level = levels.find((l) => l.id === levelOf(space.map_room_id));
    if (!level) continue;
    covered.add(space.map_room_id);
    const address = facilities.find((f) => f.id === level.facilityId)?.address;
    out.push({
      id: `space-${space.id}`,
      name: space.name,
      kind: 'study',
      address: address
        ? `${address}, ${roomName(space.map_room_id)}`
        : roomName(space.map_room_id),
      // Hönggerberg is the only campus this far north.
      campus: space.lat > 47.39 ? 'Hönggerberg' : 'Zentrum',
      operator: 'Weitere',
      availabilityNote: null,
      cardAccess24h: false,
      openingHours: null,
      description: null,
      position: { lat: space.lat, lng: space.lng },
      positionApproximate: false,
      sourceUrl: null,
      outline: null,
      facilityId: level.facilityId,
      levelId: level.id,
      floor: level.floor,
      enabled: true,
      rooms: [space.map_room_id],
      levels: [level.id],
    });
  }
  return out;
}

/**
 * The workspaces of the bookable study spaces: workspace id → study space id.
 * A space's place is the workspace that contains its map room (one from
 * `spaceWorkspaces` when no other does).
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
    if (containing) out.set(containing.id, space.id);
  }
  return out;
}
