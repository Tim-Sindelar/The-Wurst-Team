import { useEffect, useRef } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router';
import { BottomNavigation } from './BottomNavigation';

export function AppLayout() {
  const { pathname } = useLocation();
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
  }, [pathname]);
  if (import.meta.env.DEV)
    return (
      <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto]">
        <div
          ref={viewport}
          className="min-h-0 overflow-y-auto [&>.campus-map]:h-full [&>div]:min-h-full"
        >
          <Outlet />
        </div>
        <BottomNavigation />
      </div>
    );
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}
