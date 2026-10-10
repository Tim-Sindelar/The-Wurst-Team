// Live room data from the ETH Room Info API, as served by eth_room_dashboard.py
// (/api/snapshot) and enriched by the dev server with where each room is on the
// PolyMaps floor plans. Framework-free, shared by the client and server/ethRoomsApi.ts.

export type BookingKind =
  | 'lecture'
  | 'exercise'
  | 'lecture_exercise'
  | 'course_other'
  | 'event'
  | 'reserved'
  | 'cancelled'
  | 'closed';

/** One booking of today, in minutes after midnight (Zurich time). */
export interface Booking {
  s: number;
  e: number;
  kind: BookingKind;
  title: string | null;
  number: string | null;
  organiser: string | null;
}

export interface EthRoom {
  /** "HG E 7": building, floor, room. */
  id: string;
  building: string;
  floor: string;
  room: string;
  /** Room type in English, e.g. "Lecture hall". */
  type: string;
  seats: number | null;
  workplaces: number | null;
  campus: string | null;
  equipment: string[];
  bookings: Booking[];
  /** Set when this room's bookings failed to load; its status is unknown. */
  error: string | null;
}

export interface EthSnapshot {
  schemaVersion: 1;
  /** When the bookings were fetched from ETH (ISO, with offset). */
  fetchedAt: string;
  /** The day the bookings are for, YYYY-MM-DD (Zurich). */
  date: string;
  ttlSeconds: number;
  buildings: Record<string, string>;
  rooms: EthRoom[];
  errors: number;
}

/** Where an ETH room is on the floor plans. */
export interface RoomPlace {
  /** PolyMaps unit id, e.g. "ETH.HG.E.E_007". */
  unitId: string;
  levelId: string;
  floor: number;
  lat: number;
  lng: number;
}

export interface EthRoomsResponse {
  /** running: fetching from ETH; error: the last fetch failed and there is no current snapshot. */
  state: 'ok' | 'running' | 'error';
  done: number;
  total: number;
  error: string | null;
  stale: boolean;
  ageSeconds: number | null;
  nextFetchInSeconds: number | null;
  snapshot: EthSnapshot | null;
  /** ETH room id → its places on the floor plans (several when PolyMaps splits a room). */
  matches: Record<string, RoomPlace[]>;
  /** ETH rooms with no room of the same name on the floor plans. */
  unmatched: string[];
  /** False when the floor plans (public/floors) haven't been generated. */
  floorPlans: boolean;
  /** First and last day ETH has bookings for (YYYY-MM-DD); null if unknown. */
  window: { min: string | null; max: string | null } | null;
}

/**
 * Comparable form of a room name, so ETH ids and PolyMaps names match despite
 * spacing, case and zero padding: "HG  e 007.10" and "HG E 7.10" → "HG E 7.10".
 */
export function roomKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .map((token) => token.replace(/\d+/g, (digits) => String(Number(digits))))
    .join(' ');
}

/** "ETH.HG.H.H_030.1" → "HG H 030.1" (the name PolyMaps would give it); null if it doesn't look like that. */
export function unitIdName(unitId: string): string | null {
  const parts = unitId.split('.');
  if (parts.length < 4) return null;
  const [, building, , first, ...rest] = parts;
  const sep = first.indexOf('_');
  if (sep <= 0) return null;
  return `${building} ${first.slice(0, sep)} ${[first.slice(sep + 1), ...rest].join('.')}`;
}

// ---- status -------------------------------------------------------------------

export type RoomStatus = 'free' | 'soon' | 'busy' | 'closed' | 'unknown';

export const ROOM_STATUSES: RoomStatus[] = [
  'free',
  'soon',
  'busy',
  'closed',
  'unknown',
];

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  free: 'Free',
  soon: 'Booked soon',
  busy: 'In use',
  closed: 'Building closed',
  unknown: 'No data',
};

export const BOOKING_KIND_LABELS: Record<BookingKind, string> = {
  lecture: 'Lecture',
  exercise: 'Exercise',
  lecture_exercise: 'Lecture + exercise',
  course_other: 'Course',
  event: 'Event',
  reserved: 'Reserved',
  cancelled: 'Cancelled',
  closed: 'Building closed',
};

const BUSY = new Set<BookingKind>([
  'lecture',
  'exercise',
  'lecture_exercise',
  'course_other',
  'event',
  'reserved',
]);
export const isBusy = (b: Booking) => BUSY.has(b.kind);

export interface RoomState {
  status: RoomStatus;
  /** The booking (or closed period) the room is in right now. */
  current: Booking | null;
  /** First booking or closing after now (free/soon), or the end of the current one. */
  next: Booking | null;
  /** Minute the current status ends (1440 = end of day). */
  until: number;
}

/** Status of a room at `minute` of the snapshot day; "soon" when a booking starts within `soonMinutes`. */
export function roomStateAt(
  room: EthRoom,
  minute: number,
  soonMinutes: number,
): RoomState {
  if (room.error)
    return { status: 'unknown', current: null, next: null, until: 1440 };
  const relevant = room.bookings.filter(
    (b) => b.kind === 'closed' || isBusy(b),
  );
  const closed = relevant.find(
    (b) => b.kind === 'closed' && b.s <= minute && minute < b.e,
  );
  const busy = relevant.find((b) => isBusy(b) && b.s <= minute && minute < b.e);
  if (closed)
    return { status: 'closed', current: closed, next: null, until: closed.e };
  if (busy) {
    // Back-to-back bookings: the room stays in use until the last one ends.
    let until = busy.e;
    for (const b of relevant)
      if (isBusy(b) && b.s <= until && b.e > until) until = b.e;
    return { status: 'busy', current: busy, next: null, until };
  }
  const next =
    relevant.filter((b) => b.s > minute).sort((a, b) => a.s - b.s)[0] ?? null;
  const until = next ? next.s : 1440;
  return {
    status: next && next.s - minute <= soonMinutes ? 'soon' : 'free',
    current: null,
    next,
    until,
  };
}

/** Today's date and the minute of the day in Zurich, where the booking times are given. */
export function zurichClock(now = new Date()): {
  date: string;
  minute: number;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Zurich',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Clock time of an ISO timestamp in Zurich, e.g. "14:05". */
export const zurichTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('de-CH', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
  });

export const hhmm = (minute: number) =>
  minute >= 1440
    ? '24:00'
    : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** "1 h 30 min", "45 min" */
export function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
