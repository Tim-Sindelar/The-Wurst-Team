import type { DraftPerson } from './draft.ts';

/** Null covers both private rooms and friends without a current session. */
export function friendsWithLocationsFirst(friends: DraftPerson[], search = '') {
  const query = search.trim().toLowerCase();
  return friends
    .filter((person) => person.name.toLowerCase().includes(query))
    .sort(
      (a, b) =>
        Number(!!b.room) - Number(!!a.room) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}
