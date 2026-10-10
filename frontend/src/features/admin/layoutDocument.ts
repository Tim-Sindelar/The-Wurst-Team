import type { MultiPolygon } from 'geojson';
import geometry from './geometry';
import type { LayoutDocument, LayoutItem, RoomGeometry } from './models';
export function readLayout(value: unknown): LayoutDocument | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as LayoutDocument;
  if (
    v.schemaVersion !== 1 ||
    !Array.isArray(v.objects) ||
    !Array.isArray(v.room?.points) ||
    !Number.isFinite(v.room.width) ||
    !Number.isFinite(v.room.height)
  )
    return null;
  if (
    !v.room.measurements ||
    !Number.isFinite(v.room.measurements.widthMeters) ||
    !Number.isFinite(v.room.measurements.heightMeters)
  )
    throw Error(
      'This layout is missing room measurements. Link its room border again.',
    );
  geometry.assertLayout(v.room, v.objects);
  return v;
}
export function projectRoom(
  ref: {
    id: string;
    name: string;
    levelId?: string;
    facilityId?: string;
    floor?: number;
    workspaceId?: string;
  },
  outline: MultiPolygon,
): RoomGeometry {
  if (outline.coordinates.length !== 1 || outline.coordinates[0].length !== 1)
    throw Error(
      'Choose one room without holes. Multi-wing layouts need separate rooms.',
    );
  const ring = outline.coordinates[0][0];
  const origin = { lng: ring[0][0], lat: ring[0][1] };
  const metersLat = (6371008.8 * Math.PI) / 180,
    metersLng = metersLat * Math.cos((origin.lat * Math.PI) / 180);
  const room = geometry.roomFromCoordinates({
    id: ref.id,
    label: ref.name,
    kind: 'Study room',
    coordinateUnit: 'm',
    coordinateAxis: 'cartesian',
    approximate: true,
    boundary: ring
      .slice(0, -1)
      .map(([lng, lat]) => [
        (lng - origin.lng) * metersLng,
        (lat - origin.lat) * metersLat,
      ]),
  });
  return {
    ...room,
    mapRef: {
      unitId: ref.id,
      levelId: ref.levelId,
      facilityId: ref.facilityId,
      floor: ref.floor,
      workspaceId: ref.workspaceId,
    },
    georeference: { origin, metersLat, metersLng },
  };
}
export function documentFor(
  room: RoomGeometry,
  items: LayoutItem[],
): LayoutDocument {
  geometry.assertLayout(room, items);
  return {
    schemaVersion: 1,
    unitsPerMeter: geometry.UNITS_PER_METER,
    room,
    objects: geometry.renumber(items).map((item) => {
      const rest = { ...item };
      delete rest.state;
      return rest;
    }),
  };
}
