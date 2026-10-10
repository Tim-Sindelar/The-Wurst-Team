import { createContext, type Dispatch } from 'react';

/** View models for the isolated UI preview, not API request/response types. */
export type DraftPerson = {
  id: string;
  name: string;
  room: string | null;
  photoUrl?: string | null;
  friendshipId?: string;
};
export type DraftRequest = { person: DraftPerson; incoming: boolean };
export type DraftMember = {
  person: DraftPerson;
  status: 'invited' | 'accepted' | 'declined' | 'left';
  seat: number | null;
  checkedIn: boolean;
  cancelled: boolean;
};
export type DraftParty = {
  id: string;
  organizerId: string;
  name: string;
  status: 'open' | 'booked' | 'cancelled';
  members: DraftMember[];
  bookedAt: number | null;
};
export type DraftState = {
  demoSeedVersion: number;
  revision: number;
  friends: DraftPerson[];
  requests: DraftRequest[];
  shareRoom: boolean;
  viewer: string;
  parties: DraftParty[];
  activePartyId: string;
};
export type DraftAction = (
  | { type: 'reset' }
  | { type: 'privacy'; enabled: boolean }
  | { type: 'accept-request' | 'remove-request' | 'remove-friend'; id: string }
  | { type: 'send-request'; person: DraftPerson }
  | { type: 'create-party'; id: string; name: string }
  | { type: 'invite-members'; invited: string[] }
  | { type: 'viewer'; id: string }
  | { type: 'reply'; accept: boolean }
  | { type: 'leave' | 'cancel-party' | 'cancel-seat' | 'check-in' }
  | { type: 'book'; assignments: Record<string, number>; now: number }
) & { partyId?: string };

export const draftPaths = {
  friends: '/social-draft',
  add: '/social-draft/add',
  manage: '/social-draft/manage',
  locations: '/social-draft/locations',
  parties: '/social-draft/parties',
  newParty: '/social-draft/parties/new',
  party: '/social-draft/party',
  invite: '/social-draft/party/invite',
  seats: '/social-draft/party/seats',
  reservation: '/social-draft/party/reservation',
  scan: '/social-draft/party/scan',
} as const;

export function activeDraftParties(parties: DraftParty[]) {
  return parties.filter((p) => p.status !== 'cancelled');
}

export function partyPath(
  id: string,
  section?: 'invite' | 'seats' | 'reservation' | 'scan',
) {
  return `${draftPaths.party}/${encodeURIComponent(id)}${section ? `/${section}` : ''}`;
}

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
    demoSeedVersion: 1,
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
    activePartyId: 'afternoon-study',
    parties: [
      {
        id: 'afternoon-study',
        organizerId: 'you',
        name: 'Afternoon study',
        status: 'open',
        members: [
          asMember(organizer, true),
          ...friends.map((p) => asMember(p, true)),
        ],
        bookedAt: null,
      },
      {
        id: 'anna-study',
        organizerId: 'anna',
        name: 'Anna’s study group',
        status: 'open',
        members: [
          asMember(friends[0], true),
          asMember(organizer),
          ...friends.slice(1).map((p) => asMember(p, true)),
        ],
        bookedAt: null,
      },
    ],
  };
}

export function draftReducer(
  state: DraftState,
  action: DraftAction,
): DraftState {
  const party = state.parties.find(
    (p) => p.id === (action.partyId ?? state.activePartyId),
  );
  const viewer = party?.members.some((m) => m.person.id === state.viewer)
    ? state.viewer
    : 'you';
  const updateParty = (
    update: (party: DraftParty) => DraftParty,
  ): DraftState => ({
    ...state,
    parties: state.parties.map((p) => (p.id === party?.id ? update(p) : p)),
  });
  const updateMember = (update: (member: DraftMember) => DraftMember) =>
    updateParty((p) => ({
      ...p,
      members: p.members.map((member) =>
        member.person.id === viewer ? update(member) : member,
      ),
    }));
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
      if (!action.name.trim() || state.parties.some((p) => p.id === action.id))
        return state;
      return {
        ...state,
        viewer: 'you',
        activePartyId: action.id,
        parties: [
          {
            id: action.id,
            organizerId: 'you',
            name: action.name.trim(),
            status: 'open',
            bookedAt: null,
            members: [asMember(organizer, true)],
          },
          ...state.parties,
        ],
      };
    case 'invite-members': {
      if (!party || party.status !== 'open' || viewer !== party.organizerId)
        return state;
      const reinvited = party.members.map((m) =>
        action.invited.includes(m.person.id) &&
        ['declined', 'left'].includes(m.status)
          ? asMember(m.person)
          : m,
      );
      return updateParty((p) => ({
        ...p,
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
      }));
    }
    case 'reply':
      if (!party || party.status !== 'open' || party.organizerId === viewer)
        return state;
      return updateMember((m) => ({
        ...m,
        status: action.accept ? 'accepted' : 'declined',
      }));
    case 'leave':
      if (!party || party.status !== 'open' || party.organizerId === viewer)
        return state;
      return updateMember((m) => ({ ...m, status: 'left' }));
    case 'book':
      if (!party || party.status !== 'open' || viewer !== party.organizerId)
        return state;
      return updateParty((p) => ({
        ...p,
        status: 'booked',
        bookedAt: action.now,
        members: p.members.map((m) => ({
          ...m,
          seat: action.assignments[m.person.id] ?? null,
        })),
      }));
    case 'check-in':
      return updateMember((m) => ({ ...m, checkedIn: true }));
    case 'cancel-seat':
      return updateMember((m) => ({ ...m, cancelled: true, checkedIn: false }));
    case 'cancel-party':
      return viewer !== party?.organizerId
        ? state
        : updateParty((p) => ({
            ...p,
            status: 'cancelled',
            members: p.members.map((m) => ({
              ...m,
              cancelled: m.cancelled || !m.checkedIn,
            })),
          }));
  }
}

export const draftStorageKey = 'study-spaces:social-draft:v2';

export function socialDraftStorageKey(basePath: string) {
  return basePath === '/' ? draftStorageKey : `${basePath}${draftStorageKey}`;
}

/** Upgrade the previous one-party demo once, preserving custom parties and reservations. */
function seedDemoParties(state: DraftState): DraftState {
  if (state.demoSeedVersion === 1) return state;
  const [full, invitation] = initialDraftState().parties;
  let parties = state.parties.map((p) =>
    p.id === full.id && p.status === 'open' ? { ...full } : p,
  );
  if (!parties.some((p) => p.id === invitation.id))
    parties = [...parties, invitation];
  if (!parties.some((p) => p.id === full.id && p.status === 'open'))
    parties = [
      ...parties,
      {
        ...full,
        id: parties.some((p) => p.id === full.id)
          ? 'afternoon-study-demo'
          : full.id,
      },
    ];
  return { ...state, parties, demoSeedVersion: 1 };
}

/** Isolated from the real profile and booking stores; old/corrupt drafts reset safely. */
export function restoreDraftState(saved: string | null): DraftState {
  if (!saved) return initialDraftState();
  try {
    const state: DraftState = JSON.parse(saved);
    const person = (p: DraftPerson) =>
      typeof p?.id === 'string' &&
      typeof p.name === 'string' &&
      (p.room === null || typeof p.room === 'string');
    if (
      typeof state.shareRoom !== 'boolean' ||
      typeof state.activePartyId !== 'string' ||
      !Array.isArray(state.friends) ||
      !state.friends.every(person) ||
      !Array.isArray(state.requests) ||
      !state.requests.every(
        (r) => person(r.person) && typeof r.incoming === 'boolean',
      ) ||
      !Array.isArray(state.parties) ||
      !state.parties.length ||
      !state.parties.every(
        (p) =>
          typeof p.id === 'string' &&
          (p.organizerId === undefined ||
            (typeof p.organizerId === 'string' &&
              p.members?.some((m) => m.person?.id === p.organizerId))) &&
          typeof p.name === 'string' &&
          ['open', 'booked', 'cancelled'].includes(p.status) &&
          (p.bookedAt === null || typeof p.bookedAt === 'number') &&
          Array.isArray(p.members) &&
          p.members.some((m) => m.person?.id === 'you') &&
          p.members.every(
            (m) =>
              person(m.person) &&
              ['invited', 'accepted', 'declined', 'left'].includes(m.status) &&
              (m.seat === null || Number.isInteger(m.seat)) &&
              typeof m.checkedIn === 'boolean' &&
              typeof m.cancelled === 'boolean',
          ),
      )
    )
      return initialDraftState();
    return seedDemoParties({
      ...state,
      parties: state.parties.map((p) => ({
        ...p,
        organizerId: p.organizerId ?? 'you',
      })),
      activePartyId: state.parties.some((p) => p.id === state.activePartyId)
        ? state.activePartyId
        : state.parties[0].id,
      viewer: 'you',
      revision: 0,
    });
  } catch {
    return initialDraftState();
  }
}

export function loadDraftState(basePath = '/'): DraftState {
  try {
    return restoreDraftState(
      localStorage.getItem(socialDraftStorageKey(basePath)),
    );
  } catch {
    return initialDraftState();
  }
}

export function saveDraftState(state: DraftState, basePath = '/') {
  try {
    localStorage.setItem(
      socialDraftStorageKey(basePath),
      JSON.stringify({ ...state, viewer: 'you' }),
    );
  } catch {
    /* The preview still works in memory when browser storage is unavailable. */
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
