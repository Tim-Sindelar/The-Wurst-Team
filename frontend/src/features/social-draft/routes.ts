import type { RouteObject } from 'react-router';
import { draftPaths } from './draft';
import { socialDemoEnabled } from '../../features';

/** Live production screens; sample party screens require an explicit demo build. */
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
          Component: socialDemoEnabled
            ? (await import('./PartyDraftScreens')).PartiesDraftScreen
            : (await import('./LivePartyScreens')).LivePartiesScreen,
        }),
      },
      {
        path: 'parties/new',
        lazy: async () => ({
          Component: socialDemoEnabled
            ? (await import('./PartyDraftScreens')).PartyEditorDraftScreen
            : (await import('./LivePartyScreens')).LivePartyEditorScreen,
        }),
      },
      {
        path: 'party/:partyId',
        lazy: async () => ({
          Component: socialDemoEnabled
            ? (await import('./PartyDraftScreens')).PartyDraftScreen
            : (await import('./LivePartyScreens')).LivePartyScreen,
        }),
      },
      {
        path: 'party/:partyId/invite',
        lazy: async () => ({
          Component: socialDemoEnabled
            ? (await import('./PartyDraftScreens')).InviteFriendsDraftScreen
            : (await import('./LivePartyScreens')).LiveInviteFriendsScreen,
        }),
      },
      {
        path: 'party/:partyId/seats',
        lazy: async () => ({
          Component: socialDemoEnabled
            ? (await import('./PartyBookingDraftScreens')).PartySeatsDraftScreen
            : (await import('./LivePartyBookingScreen')).LivePartySeatsScreen,
        }),
      },
      {
        path: 'party/:partyId/reservation',
        lazy: async () => ({
          Component: socialDemoEnabled
            ? (await import('./PartyBookingDraftScreens'))
                .PartyReservationDraftScreen
            : (await import('./LivePartyScreens')).LivePartyReservationScreen,
        }),
      },
      {
        path: 'party/:partyId/scan',
        lazy: async () => ({
          Component: socialDemoEnabled
            ? (await import('./PartyBookingDraftScreens')).PartyScanDraftScreen
            : (await import('./LivePartyScreens')).LivePartyScanScreen,
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
