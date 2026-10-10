import { lazy, Suspense } from 'react';

/* Leaflet and MapLibre are big, so the map loads only when this screen opens. */
const CampusMap = lazy(() =>
  import('../campus-map/CampusMap').then((m) => ({ default: m.CampusMap })),
);

export function MapScreen() {
  return (
    <Suspense fallback={<div className="h-dvh bg-bg" />}>
      <CampusMap />
    </Suspense>
  );
}
