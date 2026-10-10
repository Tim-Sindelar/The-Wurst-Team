import { useDebouncedValue } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  acceptFriendRequestMutation,
  deleteFriendshipMutation,
  getSocialCapabilitiesOptions,
  getSocialMeOptions,
  listFriendRequestsOptions,
  listFriendsOptions,
  searchSocialPeopleOptions,
  sendFriendRequestMutation,
  updateSocialPrivacyMutation,
} from '../../api/generated/@tanstack/react-query.gen';
import type { DirectoryPerson } from '../../api/generated';
import { apiProblem } from '../../domain/booking';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { socialDemoEnabled } from '../../features';
import { samplePeople } from './directory';
import type { DraftPerson } from './draft';
import { useSocialDraft } from './useSocialDraft';

/** Real friendships when enabled; explicit sample mode when disabled. Never
 * turn a network/auth failure into a successful sample mutation. */
export function useFriends(search = '') {
  const draft = useSocialDraft();
  const currentUser = useCurrentUser();
  const { user } = currentUser;
  const queryClient = useQueryClient();
  const capabilities = useQuery({
    ...getSocialCapabilitiesOptions({ redirect: 'error' }),
    retry: false,
  });
  const live = capabilities.data?.enabled === true;
  const demo = socialDemoEnabled && capabilities.data?.enabled === false;
  const enabled = live && !!user;
  const me = useQuery({
    ...getSocialMeOptions({ redirect: 'error' }),
    enabled,
    staleTime: 0,
    retry: false,
  });
  const friends = useQuery({
    ...listFriendsOptions({ redirect: 'error' }),
    enabled,
    staleTime: 0,
    retry: false,
    refetchInterval: 20000,
  });
  const requests = useQuery({
    ...listFriendRequestsOptions({ redirect: 'error' }),
    enabled,
    staleTime: 0,
    retry: false,
    refetchInterval: 20000,
  });
  const [query] = useDebouncedValue(search.trim(), 250);
  const directory = useQuery({
    ...searchSocialPeopleOptions({ query: { q: query }, redirect: 'error' }),
    enabled: enabled && query.length >= 2,
    retry: false,
  });
  const send = useMutation(sendFriendRequestMutation({ redirect: 'error' }));
  const accept = useMutation(
    acceptFriendRequestMutation({ redirect: 'error' }),
  );
  const remove = useMutation(deleteFriendshipMutation({ redirect: 'error' }));
  const privacy = useMutation(
    updateSocialPrivacyMutation({ redirect: 'error' }),
  );
  const [mutationError, setMutationError] = useState('');
  const busy =
    send.isPending || accept.isPending || remove.isPending || privacy.isPending;
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        [
          'listFriends',
          'listFriendRequests',
          'getSocialMe',
          'searchSocialPeople',
        ].includes((queryKey[0] as { _id?: string })?._id ?? ''),
    });
  const perform = async (work: () => Promise<unknown>) => {
    setMutationError('');
    if (!live && !demo) return false;
    try {
      await work();
      if (live) await refresh();
      return true;
    } catch (error) {
      setMutationError(apiProblem(error).message);
      if (live) await refresh();
      return false;
    }
  };
  const queryError =
    capabilities.error ||
    currentUser.error ||
    (live && (me.error || friends.error || requests.error || directory.error));
  const person = (
    p: { id: string; name: string; photo_url?: string | null },
    room: string | null = null,
    friendshipId?: string,
  ): DraftPerson => ({
    id: p.id,
    name: p.name,
    room,
    photoUrl: p.photo_url,
    friendshipId,
  });
  return {
    live,
    demo,
    retry: async () => {
      setMutationError('');
      await currentUser.refetch();
      await capabilities.refetch();
      await refresh();
    },
    busy,
    loading:
      capabilities.isPending ||
      (live &&
        (!user || me.isPending || friends.isPending || requests.isPending)),
    error:
      mutationError ||
      (queryError ? apiProblem(queryError).message : '') ||
      (capabilities.data?.enabled === false && !demo
        ? 'Friends are temporarily unavailable. Please try again later.'
        : ''),
    shareRoom: demo ? draft.state.shareRoom : (me.data?.share_room ?? false),
    friends: demo
      ? draft.state.friends
      : friends.isError
        ? []
        : (friends.data?.friends ?? []).map((f) =>
            person(f.person, f.room?.name ?? null, f.friendship_id),
          ),
    requests: demo
      ? draft.state.requests
      : requests.isError
        ? []
        : (requests.data?.requests ?? []).map((r) => ({
            person: person(r.person, null, r.id),
            incoming: r.direction === 'incoming',
          })),
    people: demo
      ? samplePeople(draft.state, search)
      : query === search.trim() && !directory.isError
        ? (directory.data?.people ?? [])
        : [],
    searching:
      live &&
      search.trim().length >= 2 &&
      (query !== search.trim() || directory.isFetching),
    send: (p: DirectoryPerson) =>
      perform(async () => {
        if (live) await send.mutateAsync({ body: { user_id: p.id } });
        else draft.dispatch({ type: 'send-request', person: person(p) });
      }),
    accept: (p: DraftPerson) =>
      perform(async () => {
        if (live)
          await accept.mutateAsync({
            path: { friendship_id: p.friendshipId! },
          });
        else draft.dispatch({ type: 'accept-request', id: p.id });
      }),
    remove: (p: DraftPerson, request = false) =>
      perform(async () => {
        if (live)
          await remove.mutateAsync({
            path: { friendship_id: p.friendshipId! },
          });
        else
          draft.dispatch({
            type: request ? 'remove-request' : 'remove-friend',
            id: p.id,
          });
      }),
    privacy: (share_room: boolean) =>
      perform(async () => {
        if (live) await privacy.mutateAsync({ body: { share_room } });
        else draft.dispatch({ type: 'privacy', enabled: share_room });
      }),
  };
}
