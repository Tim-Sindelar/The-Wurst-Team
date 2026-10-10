import { useQuery } from '@tanstack/react-query';
import { getRulesOptions } from '../api/generated/@tanstack/react-query.gen';

/** The booking timing rules, in minutes. They come from the backend config
    (backend/app/config.py) and rarely change, so they are fetched once. */
export function useRules() {
  const query = useQuery({ ...getRulesOptions(), staleTime: Infinity });
  return { query, rules: query.data ?? null };
}
