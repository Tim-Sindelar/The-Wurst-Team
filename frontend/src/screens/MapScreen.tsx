import { lazy, Suspense } from 'react';
import { MapLoading } from '../components/MapLoading';

/* Leaflet and MapLibre are big, so the map loads only when this screen opens. */
const CampusMap = lazy(() =>
  import('../campus-map/CampusMap').then((m) => ({ default: m.CampusMap })),
);

export function MapScreen() {
  return (
    <Suspense
      fallback={
        <div className="relative h-full">
          <MapLoading />
        </div>
      }
    >
      <CampusMap />
    </Suspense>
  );
}
