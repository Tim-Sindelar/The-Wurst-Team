import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { BottomNavigation } from './BottomNavigation';
import { useCurrentUser } from '../hooks/useCurrentUser';

export function AppLayout() {
  // Register the signed-in display profile even without a Home avatar shortcut.
  useCurrentUser();
  const { pathname } = useLocation();
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto]">
      <div
        ref={viewport}
        className="min-h-0 overflow-y-auto [&>.campus-map]:h-full [&>.h-dvh]:h-full [&>div]:min-h-full"
      >
        <Outlet />
      </div>
      <BottomNavigation />
    </div>
  );
}
