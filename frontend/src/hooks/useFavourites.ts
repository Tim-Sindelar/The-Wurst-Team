import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listFavouritesOptions,
  listFavouritesQueryKey,
} from '../api/generated/@tanstack/react-query.gen';
import { addFavourite, removeFavourite } from '../api/generated/sdk.gen';
import type { FavouritesResponse } from '../api/generated';

/** The user's favourite study spaces. Toggling updates the star at once and
    rolls back if the server refuses. */
export function useFavourites() {
  const client = useQueryClient();
  const queryKey = listFavouritesQueryKey();
  const query = useQuery(listFavouritesOptions());

  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      (on ? addFavourite : removeFavourite)({
        path: { space_id: id },
        throwOnError: true,
      }),
    onMutate: async ({ id, on }) => {
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<FavouritesResponse>(queryKey);
      const rest = (previous?.space_ids ?? []).filter((item) => item !== id);
      client.setQueryData<FavouritesResponse>(queryKey, {
        space_ids: on ? [...rest, id] : rest,
      });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(queryKey, context.previous);
    },
    onSettled: () => void client.invalidateQueries({ queryKey }),
  });

  return {
    query,
    ids: new Set(query.data?.space_ids ?? []),
    toggle: (id: string, on: boolean) => toggle.mutate({ id, on }),
    failed: toggle.isError,
  };
}
