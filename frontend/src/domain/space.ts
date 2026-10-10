import type { SpaceSummary } from '../api/generated';
import { searchByName } from './similarity.ts';

export type Availability = 'high' | 'mid' | 'none';

export type StudySpace = {
  id: string;
  name: string;
  freeSeats: number;
  availability: Availability;
  availabilityText: string;
  favourite: boolean;
  /** The room's photo, once the API has one. Without it the card stays plain. */
  photoUrl?: string;
};

/** At or below this share of free seats a room counts as almost full. */
const almostFullShare = 0.25;

/** How full a room is, as a level and the words for it. */
export function describeAvailability(
  freeSeats: number,
  totalSeats: number,
  isOpen: boolean,
): { availability: Availability; availabilityText: string } {
  if (!isOpen) return { availability: 'none', availabilityText: 'Closed' };
  if (freeSeats === 0)
    return { availability: 'none', availabilityText: '0 free · full' };
  if (freeSeats / totalSeats <= almostFullShare)
    return {
      availability: 'mid',
      availabilityText: `${freeSeats} free · almost full`,
    };
  return { availability: 'high', availabilityText: `${freeSeats} free` };
}

/** Turns an API space into what the cards show. */
export function toStudySpace(
  space: SpaceSummary,
  favourite = false,
): StudySpace {
  return {
    id: space.id,
    name: space.name,
    freeSeats: space.free_seats,
    favourite,
    ...describeAvailability(space.free_seats, space.total_seats, space.is_open),
  };
}

/** The spaces that match the search text, best match first. Forgives case,
   accents, word order, partial words and small typos. */
export function filterSpaces(
  spaces: StudySpace[],
  search: string,
): StudySpace[] {
  return searchByName(spaces, search, (space) => space.name);
}

/** The favourite spaces, in their current order. */
export function favouriteSpaces(spaces: StudySpace[]): StudySpace[] {
  return spaces.filter((space) => space.favourite);
}

/** The spaces named in `ids`, in that order (recents, most popular). Ids of
   spaces not in `spaces` are skipped. */
export function spacesByIds(
  spaces: StudySpace[],
  ids: readonly string[],
): StudySpace[] {
  const byId = new Map(spaces.map((space) => [space.id, space]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
