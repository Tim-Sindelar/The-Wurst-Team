import {
  createBrowserRouter,
  Outlet,
  RouterProvider,
  ScrollRestoration,
} from 'react-router';
import { paths } from './routes';
import { HomeScreen } from './screens/HomeScreen';
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
        { path: paths.home, element: <HomeScreen /> },
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
