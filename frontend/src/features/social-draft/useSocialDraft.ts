import { useCallback, useContext } from 'react';
import { useNow } from '../../hooks/useNow';
import { useLocation, useMatch } from 'react-router';
import {
  SocialDraftContext,
  draftPaths,
  activeDraftParty,
  type DraftAction,
} from './draft';

export function useSocialDraft() {
  const value = useContext(SocialDraftContext);
  const now = useNow();
  const match = useMatch('/social-draft/party/:partyId/*');
  const { pathname } = useLocation();
  const legacy = [
    draftPaths.invite,
    draftPaths.seats,
    draftPaths.reservation,
    draftPaths.scan,
  ].some((path) => path === pathname);
  const partyId =
    (legacy ? undefined : match?.params.partyId) ?? value?.state.activePartyId;
  const dispatch = useCallback(
    (action: DraftAction) => value?.dispatch({ ...action, partyId }),
    [value, partyId],
  );
  if (!value)
    throw new Error('Social draft must be inside its preview provider');
  const party =
    value.state.parties.find((p) => p.id === partyId) ?? value.state.parties[0];
  const viewer = party.members.some((m) => m.person.id === value.state.viewer)
    ? value.state.viewer
    : 'you';
  return {
    state: { ...value.state, party, viewer },
    dispatch,
    activeParty: activeDraftParty(value.state.parties, 'you', now),
    canCreateParty: !activeDraftParty(value.state.parties, 'you', now),
    conflictingParty: value.state.parties.find(
      (p) => p.id !== party.id && activeDraftParty([p], viewer, now),
    ),
    partyExists: value.state.parties.some((p) => p.id === partyId),
  };
}
