import type { BookingState } from './bookingContext';

export function secondsUntil(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Old holds without a deadline cannot be restored as live reservations. */
export function restoreBooking(
  state: string | null,
  deadline: string | null,
  now: number,
): { booking: BookingState; expiresAt: number | null } {
  if (state === 'session') return { booking: 'session', expiresAt: null };
  const expiresAt = deadline === null ? NaN : Number(deadline);
  return state === 'reserved' && Number.isFinite(expiresAt) && expiresAt > now
    ? { booking: 'reserved', expiresAt }
    : { booking: 'none', expiresAt: null };
}
