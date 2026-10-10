import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { MockBookingContext, type BookingState } from './bookingContext';
import { mockRules } from './data';
import { restoreBooking } from './reservation';

const SEAT_KEY = 'study-seat';
const STATE_KEY = 'study-state';
const DEADLINE_KEY = 'study-reservation-deadline';
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
    /* Storage blocked: the booking lasts for this page view. */
  }
};

export function MockBookingProvider({ children }: { children: ReactNode }) {
  const [seat, setSeatState] = useState(
    () => Number(read(SEAT_KEY)) || DEFAULT_SEAT,
  );
  const [hold, setHold] = useState(() =>
    restoreBooking(read(STATE_KEY), read(DEADLINE_KEY), Date.now()),
  );

  useEffect(() => {
    write(STATE_KEY, hold.booking === 'none' ? null : hold.booking);
    write(
      DEADLINE_KEY,
      hold.expiresAt === null ? null : String(hold.expiresAt),
    );
  }, [hold]);

  // The hold expires across all screens, including after a background tab resumes.
  useEffect(() => {
    if (hold.booking !== 'reserved' || hold.expiresAt === null) return;
    const deadline = hold.expiresAt;
    const expire = () => {
      if (Date.now() < deadline) return;
      setHold((current) =>
        current.booking === 'reserved' && current.expiresAt === deadline
          ? { booking: 'none', expiresAt: null }
          : current,
      );
    };
    const timer = window.setTimeout(expire, Math.max(0, deadline - Date.now()));
    window.addEventListener('focus', expire);
    document.addEventListener('visibilitychange', expire);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', expire);
      document.removeEventListener('visibilitychange', expire);
    };
  }, [hold]);

  const setSeat = useCallback((next: number) => {
    write(SEAT_KEY, String(next));
    setSeatState(next);
  }, []);
  const reserveSeat = useCallback(
    (next: number) => {
      setSeat(next);
      setHold({
        booking: 'reserved',
        expiresAt: Date.now() + mockRules.holdSeconds * 1000,
      });
    },
    [setSeat],
  );
  const setBooking = useCallback((next: BookingState) => {
    setHold((current) => {
      if (next === 'reserved') return current;
      // An expired hold cannot become a session merely by opening the session screen.
      if (
        next === 'session' &&
        (current.booking === 'none' ||
          (current.booking === 'reserved' &&
            current.expiresAt !== null &&
            current.expiresAt <= Date.now()))
      )
        return { booking: 'none', expiresAt: null };
      return { booking: next, expiresAt: null };
    });
  }, []);
  const value = useMemo(
    () => ({
      seat,
      booking: hold.booking,
      reservationExpiresAt: hold.expiresAt,
      setSeat,
      setBooking,
      reserveSeat,
    }),
    [seat, hold, setSeat, setBooking, reserveSeat],
  );
  return <MockBookingContext value={value}>{children}</MockBookingContext>;
}
