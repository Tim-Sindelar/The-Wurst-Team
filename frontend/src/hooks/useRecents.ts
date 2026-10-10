import { useQuery } from '@tanstack/react-query';
import { listRecentsOptions } from '../api/generated/@tanstack/react-query.gen';

/** The study spaces the user booked or checked in to, most recent first.
    Booking changes refresh it through `useRefreshBooking`. */
export function useRecents() {
  const query = useQuery(listRecentsOptions());
  return { query, ids: query.data?.space_ids ?? [] };
}
