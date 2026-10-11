import type { FriendRoom } from '../../api/generated';
import { seatMapPath } from '../../routes.ts';

/** Screen paths of the social feature. */
export const socialPaths = {
  friends: '/friends',
  /** Friend requests and study group invitations, opened from the header bell. */
  requests: '/requests',
  newGroup: '/groups/new',
  group: '/groups/:groupId',
  groupSeats: '/groups/:groupId/seats',
} as const;

export const groupPath = (groupId: string) =>
  `/groups/${encodeURIComponent(groupId)}`;
export const groupSeatsPath = (groupId: string) =>
  `${groupPath(groupId)}/seats`;

/** The seat map of a friend's room with their seat selected. */
export const friendSeatPath = (room: FriendRoom) =>
  `${seatMapPath(room.id)}?seat=${encodeURIComponent(room.seat_id)}`;
