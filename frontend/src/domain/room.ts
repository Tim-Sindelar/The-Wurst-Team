import type { SeatAvailability } from '../api/generated';
import type {
  Feature,
  LayoutDocument,
  LayoutItem,
  RoomGeometry,
} from '../features/admin/models';
import type { SeatState } from './seat';

/* Seats are drawn where the admin layout editor put them (SpaceDetail.layout).
   A space without a saved layout falls back to the stand-in floor plan below,
   with seats placed in label order. */

/** A seat as the map draws it. */
export type MapSeat = {
  id: string;
  label: string;
  state: SeatState;
  /** When a taken seat can be reserved for, if it can. */
  reservableAt: string | null;
  /** Centre of the seat on the room canvas. */
  x: number;
  y: number;
  /** Rotation in degrees, from the layout. */
  angle: number;
  /** Furniture size from the layout (1 = physical size). */
  scale?: number;
  badges: Feature[];
};

/** The room as the layout editor saved it, seats left out. */
export type RoomPlan = {
  room: RoomGeometry;
  furniture: LayoutItem[];
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
    with no place on the plan (counted in `hidden`). With a saved layout each
    seat sits where its layout object is; otherwise on the stand-in plan. */
export function layoutSeats(
  seats: SeatAvailability[],
  ownSeatId: string | null,
  layout: LayoutDocument | null = null,
): { plan: RoomPlan | null; shown: MapSeat[]; hidden: number } {
  const inService = seats
    .filter((seat) => seat.is_active && stateFromApi[seat.state] !== null)
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
  const mapSeat = (
    seat: SeatAvailability,
    place: Pick<MapSeat, 'x' | 'y' | 'angle' | 'scale' | 'badges'>,
  ): MapSeat => ({
    id: seat.id,
    label: seat.label,
    state: seat.id === ownSeatId ? 'yours' : stateFromApi[seat.state]!,
    reservableAt: seat.reservable_at,
    ...place,
  });

  if (layout) {
    const objects = new Map(
      layout.objects
        .filter((item) => item.type === 'seat' && item.backendSeatId)
        .map((item) => [item.backendSeatId!, item]),
    );
    const shown = inService.flatMap((seat) => {
      const item = objects.get(seat.id);
      return item
        ? [
            mapSeat(seat, {
              x: item.x,
              y: item.y,
              angle: item.angle || 0,
              scale: item.scale ?? 1,
              badges: item.badges ?? [],
            }),
          ]
        : [];
    });
    return {
      plan: {
        room: layout.room,
        furniture: layout.objects.filter((item) => item.type !== 'seat'),
      },
      shown,
      hidden: inService.length - shown.length,
    };
  }

  const shown = inService
    .slice(0, seatSlots.length)
    .map((seat, index) =>
      mapSeat(seat, { ...seatSlots[index], angle: 0, badges: [] }),
    );
  return { plan: null, shown, hidden: inService.length - shown.length };
}
