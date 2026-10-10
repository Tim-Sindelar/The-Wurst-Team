import { useQuery } from '@tanstack/react-query';
import { getMeOptions } from '../api/generated/@tanstack/react-query.gen';

export function useCurrentUser() {
  const query = useQuery({
    ...getMeOptions({ redirect: 'error' }),
    retry: false,
  });
  const user = query.isError ? undefined : query.data;
  const initials = user?.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return { ...query, user, initials };
}
