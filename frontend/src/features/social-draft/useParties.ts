import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  bookPartyMutation,
  cancelPartyMutation,
  createPartyMutation,
  getPartyOptions,
  getSocialCapabilitiesOptions,
  invitePartyMemberMutation,
  leavePartyMutation,
  listPartiesOptions,
  replyToPartyInvitationMutation,
} from '../../api/generated/@tanstack/react-query.gen';
import { apiProblem } from '../../domain/booking';
import { socialDemoEnabled } from '../../features';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useMyReservation } from '../../hooks/useMyReservation';
import { activeLiveParty } from './liveParties';

export function useParties() {
  const { partyId = '' } = useParams();
  const current = useCurrentUser();
  const booking = useMyReservation();
  const capabilities = useQuery({
    ...getSocialCapabilitiesOptions({ redirect: 'error' }),
    enabled: !socialDemoEnabled,
    retry: false,
  });
  const enabled =
    !socialDemoEnabled && capabilities.data?.enabled === true && !!current.user;
  const list = useQuery({
    ...listPartiesOptions({ redirect: 'error' }),
    enabled,
    staleTime: 0,
    refetchInterval: 15000,
    retry: false,
  });
  const detail = useQuery({
    ...getPartyOptions({ path: { party_id: partyId }, redirect: 'error' }),
    enabled: enabled && !!partyId,
    staleTime: 0,
    refetchInterval: 15000,
    retry: false,
  });
  const parties = list.data?.parties ?? [];
  const queryError =
    capabilities.error ||
    current.error ||
    list.error ||
    detail.error ||
    booking.query.error;
  const error = queryError
    ? apiProblem(queryError).message
    : capabilities.data?.enabled === false
      ? 'Study parties are temporarily unavailable. Please try again later.'
      : '';
  return {
    user: current.user,
    booking,
    parties,
    party: detail.data ?? null,
    activeParty: activeLiveParty(
      parties,
      current.user?.id,
      booking.reservation,
    ),
    loading:
      !socialDemoEnabled &&
      !error &&
      (capabilities.isPending ||
        current.isPending ||
        list.isPending ||
        booking.query.isPending ||
        (!!partyId && detail.isPending)),
    error,
    retry: () => {
      void capabilities.refetch();
      void current.refetch();
      void list.refetch();
      void booking.query.refetch();
      if (partyId) void detail.refetch();
    },
  };
}

/** One request at a time, with errors kept in place and live queries refreshed. */
export function usePartyActions() {
  const client = useQueryClient();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = useMutation(createPartyMutation({ redirect: 'error' }));
  const invite = useMutation(invitePartyMemberMutation({ redirect: 'error' }));
  const reply = useMutation(
    replyToPartyInvitationMutation({ redirect: 'error' }),
  );
  const leave = useMutation(leavePartyMutation({ redirect: 'error' }));
  const cancel = useMutation(cancelPartyMutation({ redirect: 'error' }));
  const book = useMutation(bookPartyMutation({ redirect: 'error' }));
  const perform = async <T>(
    work: () => Promise<T>,
    done?: (data: T) => void,
  ) => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await work();
      await client.invalidateQueries();
      done?.(data);
      return true;
    } catch (problem) {
      setError(apiProblem(problem).message);
      await client.invalidateQueries();
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return { busy, error, perform, create, invite, reply, leave, cancel, book };
}
