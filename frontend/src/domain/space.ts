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

/** Turns an API space into what the cards show: level plus the words for it. */
export function toStudySpace(space: SpaceSummary): StudySpace {
  const { id, name, free_seats: freeSeats, total_seats: total } = space;
  const base = { id, name, freeSeats, favourite: false };
  if (!space.is_open) {
    return { ...base, availability: 'none', availabilityText: 'Closed' };
  }
  if (freeSeats === 0) {
    return { ...base, availability: 'none', availabilityText: '0 free · full' };
  }
  if (freeSeats / total <= almostFullShare) {
    return {
      ...base,
      availability: 'mid',
      availabilityText: `${freeSeats} free · almost full`,
    };
  }
  return {
    ...base,
    availability: 'high',
    availabilityText: `${freeSeats} free`,
  };
}
