import type { DirectoryPerson } from '../../api/generated';
import { type DraftState, initialDraftState, sampleInvite } from './draft.ts';

/** Sample directory is used only when the backend explicitly disables social. */
export function samplePeople(
  state: DraftState,
  query: string,
): DirectoryPerson[] {
  const search = query.trim().toLowerCase();
  if (search.length < 2) return [];
  const initial = initialDraftState();
  const people = new Map(
    [
      sampleInvite,
      ...initial.friends,
      ...initial.requests.map((r) => r.person),
      ...state.friends,
      ...state.requests.map((r) => r.person),
    ].map((person) => [person.id, person]),
  );
  return [...people.values()]
    .filter((person) => person.name.toLowerCase().includes(search))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 20)
    .map((person) => {
      const request = state.requests.find((r) => r.person.id === person.id);
      return {
        id: person.id,
        name: person.name,
        photo_url: null,
        friendship_id: request ? person.id : null,
        relationship: state.friends.some((p) => p.id === person.id)
          ? 'friends'
          : request
            ? request.incoming
              ? 'incoming'
              : 'outgoing'
            : 'none',
      };
    });
}
