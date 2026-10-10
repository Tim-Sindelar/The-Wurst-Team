import type { MultiPolygon } from 'geojson';

// Domain model shared by the frontend and the (current or future) backend.
// The shape is normalized (flat collections with foreign keys) so it maps
// one-to-one onto database tables later.

export type { MultiPolygon };

export interface LatLng {
  lat: number;
  lng: number;
}

export type Campus = 'Zentrum' | 'Hönggerberg';

export type LibraryOperator = 'ETH-Bibliothek' | 'Weitere';

export type SeatStatus = 'free' | 'occupied' | 'unknown';

/** What kind of place a workspace is. Libraries are just one kind. */
export type WorkspaceKind =
  'library' | 'study' | 'group' | 'computer' | 'lounge' | 'other';

export const DAY_KEYS = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/** Times as "HH:MM" (24h), from < to, within one day. */
export interface TimeRange {
  from: string;
  to: string;
}

/** Opening ranges per weekday; an empty list means closed that day. */
export type OpeningHours = Record<DayKey, TimeRange[]>;

/**
 * A place with seats: a library, study area, group room, etc. The type and the
 * `libraries` collection keep their original name so stored data stays compatible.
 */
export interface Library {
  id: string;
  name: string;
  kind: WorkspaceKind;
  /** Postal address incl. room, if public. */
  address: string | null;
  campus: Campus;
  operator: LibraryOperator;
  /** Free text on when/under which conditions the place may be used (e.g. "only with a reservation"); null = none. */
  availabilityNote: string | null;
  /** Accessible around the clock with an ETH card, outside the opening hours. */
  cardAccess24h: boolean;
  /** Weekly schedule; null = not published. */
  openingHours: OpeningHours | null;
  description: string | null;
  position: LatLng;
  /** True when the pin is a best guess (no address, or room not located yet). */
  positionApproximate: boolean;
  sourceUrl: string | null;
  /**
   * Floor outline of the library as GeoJSON (coordinates are [lng, lat]).
   * Always a MultiPolygon so libraries spread over several wings fit too.
   */
  outline: MultiPolygon | null;
  /** PolyMaps building, e.g. "ETH.HG"; null when the library isn't in PolyMaps. */
  facilityId: string | null;
  /** PolyMaps level of the main room, e.g. "ETH.HG.H". */
  levelId: string | null;
  /** Floor (0 = ground floor, see LevelInfo.floor) the pin belongs to; null = shown on every floor. */
  floor: number | null;
  /** Shown on the normal map. Off unless an admin turns it on (missing = off). */
  enabled: boolean;
  /** PolyMaps room (unit) ids making up the library, possibly on several levels. */
  rooms: string[];
  /** PolyMaps level ids the rooms are on. */
  levels: string[];
}

/** A PolyMaps room picked on the map, with what's needed to place a workspace on it. */
export interface RoomRef {
  /** PolyMaps unit id, e.g. "ETH.HG.H.H_030.1". */
  id: string;
  /** Display name, e.g. "HG H 30.1". */
  name: string;
  levelId: string;
  facilityId: string;
  floor: number;
  /** Area in m² (0 when unknown). */
  area: number;
  center: LatLng;
  /** Street address of the building plus the room, e.g. "Rämistrasse 101, 8092 Zürich, HG H 30.1". */
  address: string | null;
}

export interface Table {
  id: string;
  libraryId: string;
  label: string;
  position: LatLng;
}

export interface Seat {
  id: string;
  tableId: string;
  label: string;
  position: LatLng;
  status: SeatStatus;
}

export interface OccupancyData {
  schemaVersion: 1;
  updatedAt: string;
  libraries: Library[];
  tables: Table[];
  seats: Seat[];
}

/** Upper bound on vertices per library outline. */
export const MAX_OUTLINE_VERTICES = 5_000;

export const WORKSPACE_KINDS: WorkspaceKind[] = [
  'library',
  'study',
  'group',
  'computer',
  'lounge',
  'other',
];

export const WORKSPACE_KIND_LABELS: Record<WorkspaceKind, string> = {
  library: 'Library',
  study: 'Study area',
  group: 'Group room',
  computer: 'Computer room',
  lounge: 'Lounge / café',
  other: 'Other',
};

export const CAMPUSES: Campus[] = ['Zentrum', 'Hönggerberg'];
export const SEAT_STATUSES: SeatStatus[] = ['free', 'occupied', 'unknown'];
