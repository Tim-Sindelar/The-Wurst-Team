import {
  createBrowserRouter,
  Outlet,
  Navigate,
  RouterProvider,
  ScrollRestoration,
} from 'react-router';
import { paths } from './routes';
import { AdminShell, AdminSpaceShell } from './features/admin/AdminShell';
import { AdminSpacesPage } from './features/admin/AdminSpacesPage';
import { AdminNewSpacePage } from './features/admin/AdminNewSpacePage';
import { AdminSeatsPage } from './features/admin/AdminSeatsPage';
import { AdminHoursPage } from './features/admin/AdminHoursPage';
import { AdminClosuresPage } from './features/admin/AdminClosuresPage';
import { AdminLayoutPage } from './features/admin/AdminLayoutPage';
import { AdminQrPage } from './features/admin/AdminQrPage';
import { AdminSettingsPage } from './features/admin/AdminSettingsPage';
import { AdminUsersPage, AdminUserPage } from './features/admin/AdminUsersPage';
import { SeatCheckInPage } from './features/admin/SeatCheckInPage';
import { HomeScreen } from './screens/HomeScreen';
import { MapScreen } from './screens/MapScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ReservationScreen } from './screens/ReservationScreen';
import { ScanScreen } from './screens/ScanScreen';
import { SeatMapScreen } from './screens/SeatMapScreen';
import { SessionScreen } from './screens/SessionScreen';

function RootLayout() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

const router = createBrowserRouter(
  [
    {
      element: <RootLayout />,
      children: [
        { path: '/check-in', element: <SeatCheckInPage /> },
        {
          path: '/admin',
          element: <AdminShell />,
          children: [
            { index: true, element: <AdminSpacesPage /> },
            { path: 'new', element: <AdminNewSpacePage /> },
            { path: 'users', element: <AdminUsersPage /> },
            { path: 'users/:userId', element: <AdminUserPage /> },
            { path: 'qr', element: <AdminQrPage /> },
            {
              path: 'spaces/:spaceId',
              element: <AdminSpaceShell />,
              children: [
                { index: true, element: <Navigate to="seats" replace /> },
                { path: 'seats', element: <AdminSeatsPage /> },
                { path: 'hours', element: <AdminHoursPage /> },
                { path: 'closures', element: <AdminClosuresPage /> },
                { path: 'layout', element: <AdminLayoutPage /> },
                { path: 'qr', element: <AdminQrPage /> },
                { path: 'settings', element: <AdminSettingsPage /> },
              ],
            },
          ],
        },
        { path: paths.home, element: <HomeScreen /> },
        { path: paths.map, element: <MapScreen /> },
        { path: paths.seatMap, element: <SeatMapScreen /> },
        { path: paths.reservation, element: <ReservationScreen /> },
        { path: paths.scan, element: <ScanScreen /> },
        { path: paths.session, element: <SessionScreen /> },
        { path: paths.profile, element: <ProfileScreen /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

export function App() {
  return <RouterProvider router={router} />;
}
