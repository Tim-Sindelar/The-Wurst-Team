import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { getMyReservationOptions } from '../api/generated/@tanstack/react-query.gen';
import { isHeld, isRunning, toClientMs } from '../domain/booking';

/** The signed-in user's live reservation, kept fresh. */
export function useMyReservation() {
  const query = useQuery({
    ...getMyReservationOptions(),
    refetchInterval: 15_000,
  });
  const reservation = query.data?.reservation ?? null;
  const serverTime = query.data?.server_time;
  const receivedAt = query.dataUpdatedAt;

  /** A server timestamp on this device's clock, in milliseconds. */
  const toClient = useCallback(
    (iso: string) =>
      serverTime ? toClientMs(iso, serverTime, receivedAt) : Date.parse(iso),
    [serverTime, receivedAt],
  );

  return {
    query,
    reservation,
    /** The reservation while it waits for check-in, otherwise null. */
    held: isHeld(reservation) ? reservation : null,
    /** The reservation while checked in (session or break), otherwise null. */
    running: isRunning(reservation) ? reservation : null,
    toClient,
  };
}

/** Asks the server again just after a deadline, when the state will have moved on. */
export function useRefetchAt(atMs: number | null, refetch: () => unknown) {
  useEffect(() => {
    if (atMs === null) return;
    const timer = window.setTimeout(
      () => void refetch(),
      Math.min(2 ** 31 - 1, Math.max(0, atMs - Date.now()) + 500),
    );
    return () => window.clearTimeout(timer);
  }, [atMs, refetch]);
}

/** Refreshes everything that depends on bookings: the booking and seat counts. */
export function useRefreshBooking() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries(), [queryClient]);
}
