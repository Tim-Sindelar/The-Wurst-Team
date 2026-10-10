import { useQuery } from '@tanstack/react-query';
import { listPopularSpacesOptions } from '../api/generated/@tanstack/react-query.gen';

/** The study spaces with the highest share of seats taken over the last
    week, most occupied first. */
export function usePopular() {
  const query = useQuery(listPopularSpacesOptions());
  return { query, ids: query.data?.space_ids ?? [] };
}
