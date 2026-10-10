import type { EthRoom, RoomState } from './domain/ethRooms';

/** Live room mode: what it adds to the map and the details sheet. */
export interface RoomFeatures {
  /** Master switch: load the ETH room data at all. */
  enabled: boolean;
  /** Rooms colored by booking status. */
  occupancy: boolean;
  /** Room number and seats written on the rooms (zoom 19+). */
  labels: boolean;
  /** Clicking a room opens its photos, schedule and equipment. */
  details: boolean;
  /** List of rooms that are free now, longest free first, in the live rooms menu. */
  freeList: boolean;
  /** Live study space occupancy of the nearby UZH libraries, in the live rooms menu. */
  uzh: boolean;
  /** A free room counts as "booked soon" this many minutes before its next booking. */
  soonMinutes: number;
}

export const DEFAULT_ROOM_FEATURES: RoomFeatures = {
  enabled: false,
  occupancy: true,
  labels: true,
  details: true,
  freeList: true,
  uzh: false,
  soonMinutes: 30,
};

/** An ETH room with its status at the minute being shown. */
export interface RoomInfo {
  room: EthRoom;
  state: RoomState;
}
