import { createContext, type Dispatch } from 'react';

/** View models for the isolated UI preview, not API request/response types. */
export type DraftPerson = { id: string; name: string; room: string | null };
export type DraftRequest = { person: DraftPerson; incoming: boolean };
export type DraftMember = {
  person: DraftPerson;
  status: 'invited' | 'accepted' | 'declined' | 'left';
  seat: number | null;
  checkedIn: boolean;
  cancelled: boolean;
};
export type DraftParty = {
  name: string;
  status: 'open' | 'booked' | 'cancelled';
  members: DraftMember[];
  bookedAt: number | null;
};
export type DraftState = {
  revision: number;
  friends: DraftPerson[];
  requests: DraftRequest[];
  shareRoom: boolean;
  viewer: string;
  party: DraftParty;
};
export type DraftAction =
  | { type: 'reset' }
  | { type: 'privacy'; enabled: boolean }
  | { type: 'accept-request' | 'remove-request' | 'remove-friend'; id: string }
  | { type: 'send-request'; person: DraftPerson }
  | { type: 'create-party'; name: string; invited: string[] }
  | { type: 'invite-members'; invited: string[] }
  | { type: 'viewer'; id: string }
  | { type: 'reply'; accept: boolean }
  | { type: 'leave' | 'cancel-party' | 'cancel-seat' | 'check-in' }
  | { type: 'book'; assignments: Record<string, number>; now: number };

export const draftPaths = {
  friends: '/social-draft',
  add: '/social-draft/add',
  parties: '/social-draft/parties',
  newParty: '/social-draft/parties/new',
  party: '/social-draft/party',
  invite: '/social-draft/party/invite',
  seats: '/social-draft/party/seats',
  reservation: '/social-draft/party/reservation',
  scan: '/social-draft/party/scan',
} as const;

export const organizer: DraftPerson = {
  id: 'you',
  name: 'Alex Müller',
  room: null,
};
export const sampleInvite: DraftPerson = {
  id: 'sam',
  name: 'Sam Keller',
  room: null,
};
export const holdSeconds = 15 * 60;
export const sessionSeconds = 120 * 60;

const asMember = (person: DraftPerson, accepted = false): DraftMember => ({
  person,
  status: accepted ? 'accepted' : 'invited',
  seat: null,
  checkedIn: false,
  cancelled: false,
});

export function initialDraftState(): DraftState {
  const friends = [
    { id: 'anna', name: 'Anna Meier', room: 'HG E 41' },
    { id: 'luca', name: 'Luca Rossi', room: null },
    {
      id: 'mia',
      name: 'Mia Alexandra von Niederhäusern-Winterthur',
      room: 'CAB E 11',
    },
  ];
  return {
    revision: 0,
    friends,
    requests: [
      {
        person: { id: 'nora', name: 'Nora Baumann', room: null },
        incoming: true,
      },
      {
        person: { id: 'felix', name: 'Felix Weber', room: null },
        incoming: false,
      },
    ],
    shareRoom: false,
    viewer: 'you',
    party: {
      name: 'Afternoon study',
      status: 'open',
      members: [
        asMember(organizer, true),
        ...friends.map((p) => asMember(p, p.id !== 'anna')),
      ],
      bookedAt: null,
    },
  };
}

export function draftReducer(
  state: DraftState,
  action: DraftAction,
): DraftState {
  const updateMember = (update: (member: DraftMember) => DraftMember) => ({
    ...state,
    party: {
      ...state.party,
      members: state.party.members.map((member) =>
        member.person.id === state.viewer ? update(member) : member,
      ),
    },
  });
  switch (action.type) {
    case 'reset':
      return { ...initialDraftState(), revision: state.revision + 1 };
    case 'privacy':
      return { ...state, shareRoom: action.enabled };
    case 'viewer':
      return { ...state, viewer: action.id };
    case 'accept-request': {
      const person = state.requests.find(
        (r) => r.person.id === action.id && r.incoming,
      )?.person;
      return person
        ? {
            ...state,
            friends: [...state.friends, person],
            requests: state.requests.filter((r) => r.person.id !== action.id),
          }
        : state;
    }
    case 'remove-request':
      return {
        ...state,
        requests: state.requests.filter((r) => r.person.id !== action.id),
      };
    case 'remove-friend':
      return {
        ...state,
        friends: state.friends.filter((p) => p.id !== action.id),
      };
    case 'send-request':
      return state.requests.some((r) => r.person.id === action.person.id)
        ? state
        : {
            ...state,
            requests: [
              ...state.requests,
              { person: action.person, incoming: false },
            ],
          };
    case 'create-party':
      return {
        ...state,
        viewer: 'you',
        party: {
          name: action.name,
          status: 'open',
          bookedAt: null,
          members: [
            asMember(organizer, true),
            ...state.friends
              .filter((p) => action.invited.includes(p.id))
              .map((p) => asMember(p)),
          ],
        },
      };
    case 'invite-members': {
      const reinvited = state.party.members.map((m) =>
        action.invited.includes(m.person.id) &&
        ['declined', 'left'].includes(m.status)
          ? asMember(m.person)
          : m,
      );
      return {
        ...state,
        party: {
          ...state.party,
          members: [
            ...reinvited,
            ...state.friends
              .filter(
                (p) =>
                  action.invited.includes(p.id) &&
                  !reinvited.some((m) => m.person.id === p.id),
              )
              .map((p) => asMember(p)),
          ],
        },
      };
    }
    case 'reply':
      return updateMember((m) => ({
        ...m,
        status: action.accept ? 'accepted' : 'declined',
      }));
    case 'leave':
      return updateMember((m) => ({ ...m, status: 'left' }));
    case 'book':
      return {
        ...state,
        party: {
          ...state.party,
          status: 'booked',
          bookedAt: action.now,
          members: state.party.members.map((m) => ({
            ...m,
            seat: action.assignments[m.person.id] ?? null,
          })),
        },
      };
    case 'check-in':
      return updateMember((m) => ({ ...m, checkedIn: true }));
    case 'cancel-seat':
      return updateMember((m) => ({ ...m, cancelled: true, checkedIn: false }));
    case 'cancel-party':
      return {
        ...state,
        party: {
          ...state.party,
          status: 'cancelled',
          members: state.party.members.map((m) => ({
            ...m,
            cancelled: m.cancelled || !m.checkedIn,
          })),
        },
      };
  }
}

export const SocialDraftContext = createContext<{
  state: DraftState;
  dispatch: Dispatch<DraftAction>;
} | null>(null);

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
}
