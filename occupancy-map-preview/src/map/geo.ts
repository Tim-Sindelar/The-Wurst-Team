import type { LatLngBoundsLiteral, LatLngTuple } from 'leaflet';
import type { MultiPolygon } from '../domain/types';

// GeoJSON stores [lng, lat] with closed rings; Leaflet wants [lat, lng]
// with open rings (a repeated closing vertex would become an extra handle).

export type LeafletMultiPolygon = LatLngTuple[][][];

export const outlineToLatLngs = (outline: MultiPolygon): LeafletMultiPolygon =>
  outline.coordinates.map((polygon) =>
    polygon.map((ring) => ring.slice(0, -1).map(([lng, lat]) => [lat, lng] as LatLngTuple)),
  );

export function outlineBounds(outline: MultiPolygon): LatLngBoundsLiteral {
  let [minLat, minLng, maxLat, maxLng] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of outline.coordinates) {
    for (const [lng, lat] of polygon[0]) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  }
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}
