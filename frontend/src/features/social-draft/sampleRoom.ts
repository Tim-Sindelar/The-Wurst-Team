import type { MapSeat } from '../../domain/room';

/** Isolated social demo data; ordinary seat screens use the live API. */
export const mockSpace = { name: 'HG E 41', building: 'Main building' };

const slots = [
  [132, 92, 'free'],
  [188, 92, 'occupied'],
  [132, 188, 'reserved'],
  [188, 188, 'free'],
  [408, 92, 'break'],
  [464, 92, 'free'],
  [408, 188, 'occupied'],
  [464, 188, 'bookable'],
  [132, 252, 'free'],
  [188, 252, 'reserved'],
  [132, 348, 'break'],
  [188, 348, 'free'],
  [408, 252, 'occupied'],
  [464, 252, 'free'],
  [408, 348, 'reserved'],
  [464, 348, 'free'],
  [132, 412, 'free'],
  [188, 412, 'free'],
  [132, 508, 'reserved'],
  [188, 508, 'occupied'],
  [408, 412, 'free'],
  [464, 412, 'bookable'],
  [408, 508, 'free'],
  [464, 508, 'reserved'],
  [132, 572, 'break'],
  [188, 572, 'free'],
  [132, 668, 'occupied'],
  [188, 668, 'free'],
  [408, 572, 'reserved'],
  [464, 572, 'free'],
  [408, 668, 'free'],
  [464, 668, 'occupied'],
  [548, 224, 'free'],
  [548, 284, 'reserved'],
  [548, 344, 'free'],
] as const;

export const roomSeats: MapSeat[] = slots.map(([x, y, state], index) => ({
  id: String(index + 1),
  label: String(index + 1),
  x,
  y,
  angle: 0,
  badges: [],
  state,
  reservableAt: null,
}));
