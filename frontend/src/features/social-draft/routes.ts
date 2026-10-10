import type { RouteObject } from 'react-router';
import { draftPaths } from './draft';

/** Development preview only. All screen modules load lazily and stay out of production. */
export const socialDraftRoutes: RouteObject[] = [
  {
    path: draftPaths.friends,
    lazy: async () => ({
      Component: (await import('./SocialDraftLayout')).SocialDraftLayout,
    }),
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('./FriendsDraftScreens')).FriendsDraftScreen,
        }),
      },
      {
        path: 'add',
        lazy: async () => ({
          Component: (await import('./FriendsDraftScreens'))
            .AddFriendDraftScreen,
        }),
      },
      {
        path: 'parties',
        lazy: async () => ({
          Component: (await import('./PartyDraftScreens')).PartiesDraftScreen,
        }),
      },
      {
        path: 'parties/new',
        lazy: async () => ({
          Component: (await import('./PartyDraftScreens'))
            .PartyEditorDraftScreen,
        }),
      },
      {
        path: 'party',
        lazy: async () => ({
          Component: (await import('./PartyDraftScreens')).PartyDraftScreen,
        }),
      },
      {
        path: 'party/invite',
        lazy: async () => ({
          Component: (await import('./PartyDraftScreens'))
            .PartyEditorDraftScreen,
        }),
      },
      {
        path: 'party/seats',
        lazy: async () => ({
          Component: (await import('./PartyBookingDraftScreens'))
            .PartySeatsDraftScreen,
        }),
      },
      {
        path: 'party/reservation',
        lazy: async () => ({
          Component: (await import('./PartyBookingDraftScreens'))
            .PartyReservationDraftScreen,
        }),
      },
      {
        path: 'party/scan',
        lazy: async () => ({
          Component: (await import('./PartyBookingDraftScreens'))
            .PartyScanDraftScreen,
        }),
      },
    ],
  },
];
