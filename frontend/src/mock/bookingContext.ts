import { createContext } from 'react';

/** Where the user is in the flow. Mock only: lives in the browser. */
export type BookingState = 'none' | 'reserved' | 'session';

export type MockBooking = {
  /** The seat chosen on the map; every later screen shows this number. */
  seat: number;
  booking: BookingState;
  reservationExpiresAt: number | null;
  reserveSeat: (seat: number) => void;
  setSeat: (seat: number) => void;
  setBooking: (booking: BookingState) => void;
};

export const MockBookingContext = createContext<MockBooking | null>(null);
