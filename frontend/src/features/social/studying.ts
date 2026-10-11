import type { FriendResponse, FriendRoom } from '../../api/generated';
import { initials } from './groups.ts';

/** A friend who is checked in somewhere and shares their room. */
export type StudyingFriend = FriendResponse & { room: FriendRoom };

/** Friends checked in right now, by name. */
export function studyingFriends(friends: FriendResponse[]): StudyingFriend[] {
  return friends
    .filter((friend): friend is StudyingFriend => !!friend.room)
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
}

/** "CAB G 61 · seat 14", with "on a break" when they are. */
export function friendWhere(room: FriendRoom) {
  return `${room.name} · seat ${room.seat_label}${room.on_break ? ' · on a break' : ''}`;
}

/** How a friend's avatar is marked: studying here, on a break, or not at all. */
export function studyingMark(room: FriendRoom | null) {
  if (!room) return undefined;
  return room.on_break ? ('break' as const) : ('here' as const);
}

/** A friend on the seat map: what their seat shows instead of its number. */
export type SeatFriend = {
  name: string;
  initials: string;
  photoUrl?: string | null;
  onBreak: boolean;
};

/** Friends checked in in one space, by seat id. */
export function friendsBySeat(
  friends: FriendResponse[],
  spaceId: string,
): Record<string, SeatFriend> {
  return Object.fromEntries(
    studyingFriends(friends)
      .filter((friend) => friend.room.id === spaceId)
      .map(({ person, room }) => [
        room.seat_id,
        {
          name: person.name,
          initials: initials(person.name),
          photoUrl: person.photo_url,
          onBreak: room.on_break,
        },
      ]),
  );
}
