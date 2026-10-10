import type { EthRoom, RoomState } from './domain/ethRooms';

/** Live room mode: what it adds to the map and the details sheet, each part switchable. Kept per browser. */
export interface RoomFeatures {
  /** Master switch: load the ETH room data at all. */
  enabled: boolean;
  /** Rooms colored by booking status. */
  occupancy: boolean;
  /** Room number and seats written on the rooms (zoom 19+). */
  labels: boolean;
  /** Clicking a room opens its photos, schedule and equipment. */
  details: boolean;
  /** Side panel list of rooms that are free now, longest free first. */
  freeList: boolean;
  /** Slider to look at another time of the day shown. */
  timeSlider: boolean;
  /** Live study space occupancy of the nearby UZH libraries. */
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
  timeSlider: true,
  uzh: false,
  soonMinutes: 30,
};

export const ROOM_FEATURE_LABELS: Record<
  Exclude<keyof RoomFeatures, 'enabled' | 'soonMinutes'>,
  { label: string; hint: string }
> = {
  occupancy: {
    label: 'Occupancy colors',
    hint: 'Color rooms by their bookings',
  },
  labels: { label: 'Room labels', hint: 'Room number and seats, from zoom 19' },
  details: {
    label: 'Room details on click',
    hint: 'Photos, schedule, equipment',
  },
  freeList: {
    label: 'Free rooms list',
    hint: 'In the details of a tapped room',
  },
  timeSlider: {
    label: 'Time slider',
    hint: 'Drag through the day shown (pick other days with 🕒)',
  },
  uzh: {
    label: 'UZH libraries (live)',
    hint: 'Seat occupancy nearby, in the room details',
  },
};

const KEY = 'room-features';

export function loadRoomFeatures(): RoomFeatures {
  try {
    return {
      ...DEFAULT_ROOM_FEATURES,
      ...JSON.parse(localStorage.getItem(KEY) ?? '{}'),
    };
  } catch {
    return DEFAULT_ROOM_FEATURES;
  }
}

export function saveRoomFeatures(f: RoomFeatures) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    // Storage blocked: the setting just isn't remembered.
  }
}

/** An ETH room with its status at the minute being shown. */
export interface RoomInfo {
  room: EthRoom;
  state: RoomState;
}
