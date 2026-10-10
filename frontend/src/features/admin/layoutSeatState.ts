import type { LayoutItem } from './models';

/** Draft seats are free; existing seats keep the backend's live status. */
export function layoutSeatState(
  item: LayoutItem,
  seats: { id: string; state: string }[],
): string {
  if (item.active === false) return 'unavailable';
  if (!item.backendSeatId) return 'free';
  return (
    seats.find((seat) => seat.id === item.backendSeatId)?.state || 'unknown'
  );
}
