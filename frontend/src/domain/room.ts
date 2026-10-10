import type { SeatAvailability } from '../api/generated';
import type { SeatState } from './seat';

/* The API has no seat positions yet (a room's layout is an empty object), so
   seats are placed on this stand-in floor plan in label order. Replace the
   slots with SpaceDetail.layout once the backend fills it in. */

/** A seat as the map draws it. */
export type MapSeat = {
  id: string;
  label: string;
  state: SeatState;
  /** When a taken seat can be reserved for, if it can. */
  reservableAt: string | null;
  /** Centre of the seat on the 640 × 760 room canvas. */
  x: number;
  y: number;
};

/** Seat positions on the room canvas, at the tables. */
const seatSlots = [
  { x: 132, y: 92 },
  { x: 188, y: 92 },
  { x: 132, y: 188 },
  { x: 188, y: 188 },
  { x: 408, y: 92 },
  { x: 464, y: 92 },
  { x: 408, y: 188 },
  { x: 464, y: 188 },
  { x: 132, y: 252 },
  { x: 188, y: 252 },
  { x: 132, y: 348 },
  { x: 188, y: 348 },
  { x: 408, y: 252 },
  { x: 464, y: 252 },
  { x: 408, y: 348 },
  { x: 464, y: 348 },
  { x: 132, y: 412 },
  { x: 188, y: 412 },
  { x: 132, y: 508 },
  { x: 188, y: 508 },
  { x: 408, y: 412 },
  { x: 464, y: 412 },
  { x: 408, y: 508 },
  { x: 464, y: 508 },
  { x: 132, y: 572 },
  { x: 188, y: 572 },
  { x: 132, y: 668 },
  { x: 188, y: 668 },
  { x: 408, y: 572 },
  { x: 464, y: 572 },
  { x: 408, y: 668 },
  { x: 464, y: 668 },
  { x: 548, y: 224 },
  { x: 548, y: 284 },
  { x: 548, y: 344 },
];

export type Table = {
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const roomTables: Table[] = [
  { label: 'A', x: 96, y: 122, width: 128, height: 36 },
  { label: 'B', x: 372, y: 122, width: 128, height: 36 },
  { label: 'C', x: 96, y: 282, width: 128, height: 36 },
  { label: 'D', x: 372, y: 282, width: 128, height: 36 },
  { label: 'E', x: 96, y: 442, width: 128, height: 36 },
  { label: 'F', x: 372, y: 442, width: 128, height: 36 },
  { label: 'G', x: 96, y: 602, width: 128, height: 36 },
  { label: 'H', x: 372, y: 602, width: 128, height: 36 },
  { x: 580, y: 198, width: 18, height: 192 },
];

/** Room outline on the 640 × 760 canvas: stepped footprint, windows, door. */
export const roomGeometry = {
  width: 640,
  height: 760,
  fill: 'M28 28H612V450H510V732H28Z',
  walls: 'M260 732H28V28H612V450H510V732H330',
  windows: 'M82 28H236M342 28H486M612 208V392',
  door: 'M260 732V662M260 662A70 70 0 0 1 330 732',
};

const stateFromApi: Record<
  SeatAvailability['state'],
  Exclude<SeatState, 'yours'> | null
> = {
  free: 'free',
  reserved: 'reserved',
  occupied: 'occupied',
  on_break: 'break',
  claimable: 'bookable',
  unavailable: null,
};

/** Seats for the map. Out-of-service seats are left off, and so are seats
    beyond the stand-in plan (counted in `hidden`). */
export function layoutSeats(
  seats: SeatAvailability[],
  ownSeatId: string | null,
): { shown: MapSeat[]; hidden: number } {
  const inService = seats
    .filter((seat) => seat.is_active && stateFromApi[seat.state] !== null)
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
  const shown = inService.slice(0, seatSlots.length).map((seat, index) => ({
    id: seat.id,
    label: seat.label,
    state:
      seat.id === ownSeatId ? ('yours' as const) : stateFromApi[seat.state]!,
    reservableAt: seat.reservable_at,
    ...seatSlots[index],
  }));
  return { shown, hidden: inService.length - shown.length };
}
