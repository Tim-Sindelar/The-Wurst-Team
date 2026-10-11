import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { socialEnabled } from './features';
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
import { HomeScreen } from './screens/HomeScreen';
import { MapScreen } from './screens/MapScreen';
import { NotFoundScreen, RouteErrorScreen } from './screens/NotFoundScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ProfileEditScreen } from './screens/ProfileEditScreen';
import { ReservationScreen } from './screens/ReservationScreen';
import { ScanScreen } from './screens/ScanScreen';
import { SeatMapScreen } from './screens/SeatMapScreen';
import { SeatQrScreen } from './screens/SeatQrScreen';
import { SessionScreen } from './screens/SessionScreen';

const socialRoutes = socialEnabled
  ? (await import('./features/social/routes')).socialRoutes
  : [];

const router = createBrowserRouter(
  [
    {
      path: '/admin',
      element: <AdminShell />,
      errorElement: <RouteErrorScreen />,
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
    {
      element: <AppLayout />,
      errorElement: <RouteErrorScreen />,
      children: [
        { path: paths.home, element: <HomeScreen /> },
        { path: paths.map, element: <MapScreen /> },
        { path: '/seats', element: <Navigate to={paths.home} replace /> },
        { path: paths.seatMap, element: <SeatMapScreen /> },
        { path: paths.seatQr, element: <SeatQrScreen /> },
        { path: paths.reservation, element: <ReservationScreen /> },
        { path: paths.scan, element: <ScanScreen /> },
        { path: paths.session, element: <SessionScreen /> },
        { path: paths.profile, element: <ProfileScreen /> },
        { path: paths.profileEdit, element: <ProfileEditScreen /> },
        ...socialRoutes,
        { path: '*', element: <NotFoundScreen /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

export function App() {
  return <RouterProvider router={router} />;
}
