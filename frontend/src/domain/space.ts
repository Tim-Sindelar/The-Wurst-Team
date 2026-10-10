import type { SpaceSummary } from '../api/generated';

export type Availability = 'high' | 'mid' | 'none';

export type StudySpace = {
  id: string;
  name: string;
  freeSeats: number;
  availability: Availability;
  availabilityText: string;
  favourite: boolean;
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
export function toStudySpace(space: SpaceSummary): StudySpace {
  return {
    id: space.id,
    name: space.name,
    freeSeats: space.free_seats,
    favourite: false,
    ...describeAvailability(space.free_seats, space.total_seats, space.is_open),
  };
}
