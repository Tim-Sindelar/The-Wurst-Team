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

export interface Library {
  id: string;
  name: string;
  /** Postal address incl. room, if public. */
  address: string | null;
  campus: Campus;
  operator: LibraryOperator;
  openingHours: string | null;
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

export const CAMPUSES: Campus[] = ['Zentrum', 'Hönggerberg'];
export const SEAT_STATUSES: SeatStatus[] = ['free', 'occupied', 'unknown'];
