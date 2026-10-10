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
