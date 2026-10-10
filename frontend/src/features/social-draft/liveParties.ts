import type { PartyResponse, ReservationDetails } from '../../api/generated';
import { isHeld, isRunning } from '../../domain/booking';

/** Membership, rather than invitations or old bookings, occupies the party slot. */
export function activeLiveParty(
  parties: PartyResponse[],
  userId: string | undefined,
  reservation: ReservationDetails | null,
) {
  return parties.find((party) => {
    const member = party.members.find((m) => m.person.id === userId);
    if (member?.status !== 'accepted' || party.status === 'cancelled')
      return false;
    if (party.status === 'open') return true;
    return (
      !!reservation &&
      (isHeld(reservation) || isRunning(reservation)) &&
      member.reservation_id === reservation.id
    );
  });
}
