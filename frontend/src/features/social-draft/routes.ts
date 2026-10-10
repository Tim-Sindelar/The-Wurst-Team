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
        path: 'manage',
        lazy: async () => ({
          Component: (await import('./FriendsDraftScreens'))
            .ManageFriendsDraftScreen,
        }),
      },
      {
        path: 'locations',
        lazy: async () => ({
          Component: (await import('./FriendsDraftScreens'))
            .FriendLocationsDraftScreen,
        }),
      },
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
        path: 'party/:partyId',
        lazy: async () => ({
          Component: (await import('./PartyDraftScreens')).PartyDraftScreen,
        }),
      },
      {
        path: 'party/:partyId/invite',
        lazy: async () => ({
          Component: (await import('./PartyDraftScreens'))
            .InviteFriendsDraftScreen,
        }),
      },
      {
        path: 'party/:partyId/seats',
        lazy: async () => ({
          Component: (await import('./PartyBookingDraftScreens'))
            .PartySeatsDraftScreen,
        }),
      },
      {
        path: 'party/:partyId/reservation',
        lazy: async () => ({
          Component: (await import('./PartyBookingDraftScreens'))
            .PartyReservationDraftScreen,
        }),
      },
      {
        path: 'party/:partyId/scan',
        lazy: async () => ({
          Component: (await import('./PartyBookingDraftScreens'))
            .PartyScanDraftScreen,
        }),
      },
      ...[
        'party',
        'party/invite',
        'party/seats',
        'party/reservation',
        'party/scan',
      ].map((path) => ({
        path,
        lazy: async () => ({
          Component: (await import('./SocialDraftLayout')).LegacyPartyRedirect,
        }),
      })),
    ],
  },
];
