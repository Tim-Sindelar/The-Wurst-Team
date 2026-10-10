import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { paths } from './routes';
import { HomeScreen } from './screens/HomeScreen';
import { MapScreen } from './screens/MapScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ReservationScreen } from './screens/ReservationScreen';
import { ScanScreen } from './screens/ScanScreen';
import { SeatMapScreen } from './screens/SeatMapScreen';
import { SessionScreen } from './screens/SessionScreen';

const socialDraftRoutes = import.meta.env.DEV
  ? (await import('./features/social-draft/routes')).socialDraftRoutes
  : [];

const router = createBrowserRouter(
  [
    {
      element: <AppLayout />,
      children: [
        { path: paths.home, element: <HomeScreen /> },
        { path: paths.map, element: <MapScreen /> },
        { path: '/seats', element: <Navigate to={paths.home} replace /> },
        { path: paths.seatMap, element: <SeatMapScreen /> },
        { path: paths.reservation, element: <ReservationScreen /> },
        { path: paths.scan, element: <ScanScreen /> },
        { path: paths.session, element: <SessionScreen /> },
        { path: paths.profile, element: <ProfileScreen /> },
        ...socialDraftRoutes,
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

export function App() {
  return <RouterProvider router={router} />;
}
