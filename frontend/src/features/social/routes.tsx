import { Navigate, type RouteObject } from 'react-router';
import { socialPaths } from './paths';

/* The social screens, loaded on first visit. Old /social-draft links land on Friends. */
export const socialRoutes: RouteObject[] = [
  {
    path: socialPaths.friends,
    lazy: async () => ({
      Component: (await import('./FriendsScreen')).FriendsScreen,
    }),
  },
  {
    path: socialPaths.requests,
    lazy: async () => ({
      Component: (await import('./RequestsScreen')).RequestsScreen,
    }),
  },
  {
    path: socialPaths.newGroup,
    lazy: async () => ({
      Component: (await import('./NewGroupScreen')).NewGroupScreen,
    }),
  },
  {
    path: socialPaths.group,
    lazy: async () => ({
      Component: (await import('./GroupScreen')).GroupScreen,
    }),
  },
  {
    path: socialPaths.groupSeats,
    lazy: async () => ({
      Component: (await import('./GroupSeatsScreen')).GroupSeatsScreen,
    }),
  },
  {
    path: '/social-draft/*',
    element: <Navigate replace to={socialPaths.friends} />,
  },
];
