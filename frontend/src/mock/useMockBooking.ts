import { useContext } from 'react';
import { MockBookingContext } from './bookingContext';

export function useMockBooking() {
  const booking = useContext(MockBookingContext);
  if (!booking) throw new Error('useMockBooking needs a MockBookingProvider');
  return booking;
}
