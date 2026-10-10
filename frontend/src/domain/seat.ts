export type SeatState =
  'free' | 'reserved' | 'occupied' | 'break' | 'bookable' | 'yours';

/** Short state name, used on chips and in the map key. */
export const seatStateName: Record<SeatState, string> = {
  free: 'Free',
  reserved: 'Reserved',
  occupied: 'Occupied',
  break: 'On break',
  bookable: 'Occupied, bookable',
  yours: 'Yours',
};

/** One line describing the state, for the selected seat card. */
export const seatStateDetail: Record<SeatState, string> = {
  free: 'Available now',
  reserved: 'Reserved by another student',
  occupied: 'Currently occupied',
  break: 'Held while the student is on break',
  bookable: 'Occupied · available to reserve for later',
  yours: 'Your seat',
};

/* Tailwind classes per state. Written out in full so Tailwind can find them. */

/** Sets --state, read by chips, notices and map key swatches. */
export const stateVar: Record<SeatState, string> = {
  free: '[--state:var(--color-seat-free)]',
  reserved: '[--state:var(--color-seat-reserved)]',
  occupied: '[--state:var(--color-seat-occupied)]',
  break: '[--state:var(--color-seat-break)]',
  bookable: '[--state:var(--color-seat-bookable)]',
  yours: '[--state:var(--color-seat-yours)]',
};

/** 6px left stripe on a card. */
export const stripeClass: Record<SeatState, string> = {
  free: 'border-l-6 border-l-seat-free',
  reserved: 'border-l-6 border-l-seat-reserved',
  occupied: 'border-l-6 border-l-seat-occupied',
  break: 'border-l-6 border-l-seat-break',
  bookable: 'border-l-6 border-l-seat-bookable',
  yours: 'border-l-6 border-l-seat-yours',
};

export const isReservable = (state: SeatState) =>
  state === 'free' || state === 'bookable';
