import { useDebouncedValue } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  acceptFriendRequestMutation,
  bookPartyMutation,
  cancelPartyMutation,
  createPartyMutation,
  deleteFriendshipMutation,
  getPartyOptions,
  getSocialCapabilitiesOptions,
  getSocialMeOptions,
  invitePartyMemberMutation,
  leavePartyMutation,
  listFriendRequestsOptions,
  listFriendsOptions,
  listPartiesOptions,
  replyToPartyInvitationMutation,
  searchSocialPeopleOptions,
  sendFriendRequestMutation,
  updateSocialPrivacyMutation,
} from '../../api/generated/@tanstack/react-query.gen';
import type { SocialPerson } from '../../api/generated';
import { apiProblem, isMissing, type ApiProblem } from '../../domain/booking';
import { searchByName } from '../../domain/similarity';
import { socialEnabled } from '../../features';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useMyReservation } from '../../hooks/useMyReservation';
import { activeGroup, invitations, lastCancelledGroup } from './groups';

/* Live social data. Every call uses redirect: 'error' so an expired login shows
   as an error in place instead of a redirect in the middle of a fetch. */
const live = { redirect: 'error' } as const;
const fresh = { staleTime: 0, retry: false } as const;

/** Whether the social API is on for this user. */
export function useSocialAvailable() {
  const current = useCurrentUser();
  const capabilities = useQuery({
    ...getSocialCapabilitiesOptions(live),
    enabled: socialEnabled,
    retry: false,
  });
  const error = capabilities.error || current.error;
  return {
    user: current.user,
    enabled:
      socialEnabled && capabilities.data?.enabled === true && !!current.user,
    loading: capabilities.isPending || current.isPending,
    error: error
      ? apiProblem(error).message
      : capabilities.data?.enabled === false
        ? 'Friends are unavailable right now. Try again later.'
        : '',
    retry: () => {
      void capabilities.refetch();
      void current.refetch();
    },
  };
}

/** Friends, friend requests and your room-sharing setting. */
export function useFriends() {
  const available = useSocialAvailable();
  const { enabled } = available;
  const me = useQuery({ ...getSocialMeOptions(live), enabled, ...fresh });
  const friends = useQuery({
    ...listFriendsOptions(live),
    enabled,
    ...fresh,
    refetchInterval: 20_000,
  });
  const requests = useQuery({
    ...listFriendRequestsOptions(live),
    enabled,
    ...fresh,
    refetchInterval: 20_000,
  });
  const error = me.error || friends.error || requests.error;
  return {
    ...available,
    loading:
      available.loading ||
      (enabled && (me.isPending || friends.isPending || requests.isPending)),
    error: available.error || (error ? apiProblem(error).message : ''),
    shareRoom: me.data?.share_room ?? false,
    friends: friends.data?.friends ?? [],
    incoming: (requests.data?.requests ?? []).filter(
      (request) => request.direction === 'incoming',
    ),
    outgoing: (requests.data?.requests ?? []).filter(
      (request) => request.direction === 'outgoing',
    ),
    retry: () => {
      available.retry();
      void me.refetch();
      void friends.refetch();
      void requests.refetch();
    },
  };
}

/** Your friends and where they study, for screens outside Friends (the
    seat map). Empty while social is off or loading; errors stay quiet there. */
export function useFriendList() {
  const { enabled } = useSocialAvailable();
  const friends = useQuery({
    ...listFriendsOptions(live),
    enabled,
    ...fresh,
    refetchInterval: 20_000,
  });
  return friends.data?.friends ?? [];
}

/** People who use the app, by name, for adding friends. Two characters at least. */
export function usePeopleSearch(search: string) {
  const { enabled } = useSocialAvailable();
  const [query] = useDebouncedValue(search.trim(), 250);
  const result = useQuery({
    ...searchSocialPeopleOptions({ ...live, query: { q: query } }),
    enabled: enabled && query.length >= 2,
    retry: false,
  });
  const settled = query === search.trim();
  return {
    people: settled && !result.isError ? (result.data?.people ?? []) : [],
    searching: search.trim().length >= 2 && (!settled || result.isFetching),
    error: result.error ? apiProblem(result.error).message : '',
  };
}

/** People to invite to a study party: friends first (all of them before
    anything is typed), then anyone else whose name matches. */
export function useInvitable(search: string) {
  const social = useFriends();
  const directory = usePeopleSearch(search);
  const friends = searchByName(
    social.friends.map((friend) => friend.person),
    search,
    (person) => person.name,
  );
  const friendIds = new Set(friends.map((person) => person.id));
  const others: SocialPerson[] = directory.people
    .filter((person) => person.relationship !== 'friends')
    .filter((person) => !friendIds.has(person.id))
    .map(({ id, name, photo_url }) => ({ id, name, photo_url }));
  return {
    people: [...friends, ...others],
    searching: directory.searching,
    loading: social.loading,
    error: social.error,
    searchError: directory.error,
    retry: social.retry,
  };
}

/** Your study parties: the one you're in, open invitations, and the last one you
    cancelled. */
export function useGroups() {
  const available = useSocialAvailable();
  const booking = useMyReservation();
  const list = useQuery({
    ...listPartiesOptions(live),
    enabled: available.enabled,
    ...fresh,
    refetchInterval: 15_000,
  });
  const groups = list.data?.parties ?? [];
  const userId = available.user?.id;
  const error = list.error || booking.query.error;
  return {
    ...available,
    booking,
    groups,
    active: activeGroup(groups, userId, booking.reservation),
    invitations: invitations(groups, userId),
    lastCancelled: lastCancelledGroup(groups, userId),
    loading:
      available.loading ||
      (available.enabled && (list.isPending || booking.query.isPending)),
    error: available.error || (error ? apiProblem(error).message : ''),
    retry: () => {
      available.retry();
      void list.refetch();
      void booking.query.refetch();
    },
  };
}

/** One study party, kept fresh. */
export function useGroup(groupId: string) {
  const groups = useGroups();
  const detail = useQuery({
    ...getPartyOptions({ ...live, path: { party_id: groupId } }),
    enabled: groups.enabled && !!groupId,
    ...fresh,
    refetchInterval: 15_000,
  });
  const missing = detail.error !== null && isMissing(detail.error);
  return {
    ...groups,
    group: detail.data ?? null,
    /** The group doesn't exist, or you were never in it. */
    missing,
    loading: groups.loading || (groups.enabled && detail.isPending),
    error:
      groups.error ||
      (missing
        ? "This study party doesn't exist, or you're not in it."
        : detail.error
          ? apiProblem(detail.error).message
          : ''),
    retry: () => {
      groups.retry();
      void detail.refetch();
    },
  };
}

/** How many requests wait for an answer: friend requests and group invitations.
    Shown on the header bell. */
export function useRequestCount() {
  const { enabled, user } = useSocialAvailable();
  const requests = useQuery({
    ...listFriendRequestsOptions(live),
    enabled,
    ...fresh,
    refetchInterval: 20_000,
  });
  const groups = useQuery({
    ...listPartiesOptions(live),
    enabled,
    ...fresh,
    refetchInterval: 20_000,
  });
  return {
    enabled,
    count:
      (requests.data?.requests ?? []).filter(
        (request) => request.direction === 'incoming',
      ).length + invitations(groups.data?.parties ?? [], user?.id).length,
  };
}

/** Every social change: one request at a time, the error kept for the screen to
    show in place, and every query refreshed afterwards (seat counts too). */
export function useSocialActions() {
  const client = useQueryClient();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const mutations = {
    sendRequest: useMutation(sendFriendRequestMutation(live)),
    acceptRequest: useMutation(acceptFriendRequestMutation(live)),
    removeFriendship: useMutation(deleteFriendshipMutation(live)),
    privacy: useMutation(updateSocialPrivacyMutation(live)),
    createGroup: useMutation(createPartyMutation(live)),
    invite: useMutation(invitePartyMemberMutation(live)),
    reply: useMutation(replyToPartyInvitationMutation(live)),
    leave: useMutation(leavePartyMutation(live)),
    cancel: useMutation(cancelPartyMutation(live)),
    book: useMutation(bookPartyMutation(live)),
  };
  /** Runs `work`; true when it succeeded. `onError` gets what went wrong. */
  const run = async (
    work: () => Promise<unknown>,
    onError?: (problem: ApiProblem) => void,
  ) => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await work();
      return true;
    } catch (caught) {
      const problem = apiProblem(caught);
      setProblem(problem);
      onError?.(problem);
      return false;
    } finally {
      await client.invalidateQueries();
      locked.current = false;
      setBusy(false);
    }
  };
  return {
    ...mutations,
    busy,
    /** What went wrong with the last change, in a sentence; '' when nothing did. */
    error: problem?.message ?? '',
    clearError: () => setProblem(null),
    run,
  };
}
