import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { MockBookingContext, type BookingState } from './bookingContext';

/* Remembers the chosen seat and booking state across screens and reloads.
   Storage can be blocked (private window), so every access is guarded. */

const storagePrefix =
  import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL;
const SEAT_KEY = `${storagePrefix}study-seat`;
const STATE_KEY = `${storagePrefix}study-state`;
const DEFAULT_SEAT = 14;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the value only lasts for this page view */
  }
};

const readBooking = (): BookingState => {
  const value = read(STATE_KEY);
  return value === 'reserved' || value === 'session' ? value : 'none';
};

export function MockBookingProvider({ children }: { children: ReactNode }) {
  const [seat, setSeatState] = useState(
    () => Number(read(SEAT_KEY)) || DEFAULT_SEAT,
  );
  const [booking, setBookingState] = useState<BookingState>(readBooking);

  const setSeat = useCallback((next: number) => {
    write(SEAT_KEY, String(next));
    setSeatState(next);
  }, []);

  const setBooking = useCallback((next: BookingState) => {
    write(STATE_KEY, next === 'none' ? null : next);
    setBookingState(next);
  }, []);

  const value = useMemo(
    () => ({ seat, booking, setSeat, setBooking }),
    [seat, booking, setSeat, setBooking],
  );

  return <MockBookingContext value={value}>{children}</MockBookingContext>;
}
