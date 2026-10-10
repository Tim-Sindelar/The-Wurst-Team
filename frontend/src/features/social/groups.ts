import type {
  PartyMemberResponse,
  PartyResponse,
  ReservationDetails,
} from '../../api/generated';
import { isHeld, isRunning } from '../../domain/booking.ts';

/* A "study group" is a party in the API. These helpers read the party list
   from the signed-in user's point of view. */

export type Group = PartyResponse;

/** Two-letter initials for an avatar without a photo. */
export function initials(name: string) {
  return name
    .trim()
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export const memberOf = (group: Group, userId: string | undefined) =>
  group.members.find((member) => member.person.id === userId);

export const going = (group: Group) =>
  group.members.filter((member) => member.status === 'accepted');

export const invited = (group: Group) =>
  group.members.filter((member) => member.status === 'invited');

export const declined = (group: Group) =>
  group.members.filter((member) => member.status === 'declined');

/** "3 going · 1 invited" */
export function groupSummary(group: Group) {
  const waiting = invited(group).length;
  return `${going(group).length} going${waiting ? ` · ${waiting} invited` : ''}`;
}

/** The group the user is in right now. Membership, not an invitation or an old
    booking, takes the one slot: an open group the user joined, or a booked
    one while their seat from it is still held or in use. */
export function activeGroup(
  groups: Group[],
  userId: string | undefined,
  reservation: ReservationDetails | null,
) {
  return (
    groups.find((group) => {
      const member = memberOf(group, userId);
      if (member?.status !== 'accepted' || group.status === 'cancelled')
        return false;
      if (group.status === 'open') return true;
      return (
        !!reservation &&
        (isHeld(reservation) || isRunning(reservation)) &&
        member.reservation_id === reservation.id
      );
    }) ?? null
  );
}

/** Open groups the user is invited to and hasn't answered. */
export const invitations = (groups: Group[], userId: string | undefined) =>
  groups.filter(
    (group) =>
      group.status === 'open' && memberOf(group, userId)?.status === 'invited',
  );

/** The user's most recently created group that was cancelled, with the people
    who were in it or invited (not the user), so it can be set up again. */
export function lastCancelledGroup(
  groups: Group[],
  userId: string | undefined,
): { name: string; people: PartyMemberResponse['person'][] } | null {
  const group = groups
    .filter(
      (item) => item.status === 'cancelled' && item.organizer_id === userId,
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!group) return null;
  return {
    name: group.name,
    people: group.members
      .filter(
        (member) =>
          member.person.id !== userId &&
          (member.status === 'accepted' || member.status === 'invited'),
      )
      .map((member) => member.person),
  };
}
