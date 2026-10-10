/** Screen paths, in flow order. */
export const paths = {
  home: '/',
  seatMap: '/seats/:spaceId',
  reservation: '/reservation',
  scan: '/scan',
  session: '/session',
  profile: '/profile',
} as const;

/** The seat map of one study space. */
export const seatMapPath = (spaceId: string) => `/seats/${spaceId}`;
