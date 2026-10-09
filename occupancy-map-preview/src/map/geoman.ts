// Leaflet-Geoman reads the global `L`, so expose Leaflet before loading it.
import L from 'leaflet';

(window as unknown as { L: typeof L }).L = L;
await import('@geoman-io/leaflet-geoman-free');
await import('@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css');

// Opt-in: Geoman only manages layers created with `pmIgnore: false`, so the
// edit/drag/remove modes never touch library, table or seat markers.
L.PM.setOptIn(true);

export {};
