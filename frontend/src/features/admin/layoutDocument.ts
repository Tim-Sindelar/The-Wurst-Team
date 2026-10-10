import type { MultiPolygon } from 'geojson';
import geometry from './geometry';
import { alignLayoutWalls } from './layoutOrientation';
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
  const aligned = alignLayoutWalls(v);
  geometry.assertLayout(aligned.room, aligned.objects);
  return aligned;
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
  if (outline.coordinates.length !== 1)
    throw Error(
      'Choose a room in one piece. Multi-wing layouts need separate rooms.',
    );
  const [ring, ...holes] = outline.coordinates[0];
  const origin = { lng: ring[0][0], lat: ring[0][1] };
  const metersLat = (6371008.8 * Math.PI) / 180,
    metersLng = metersLat * Math.cos((origin.lat * Math.PI) / 180);
  const toMeters = (r: number[][]) =>
    r
      .slice(0, -1)
      .map(([lng, lat]) => [
        (lng - origin.lng) * metersLng,
        (lat - origin.lat) * metersLat,
      ]);
  const room = geometry.roomFromCoordinates({
    id: ref.id,
    label: ref.name,
    kind: 'Study room',
    coordinateUnit: 'm',
    coordinateAxis: 'cartesian',
    approximate: true,
    boundary: toMeters(ring),
    ...(holes.length ? { holes: holes.map(toMeters) } : {}),
  });
  return alignLayoutWalls({
    schemaVersion: 1,
    unitsPerMeter: geometry.UNITS_PER_METER,
    objects: [],
    room: {
      ...room,
      mapRef: {
        unitId: ref.id,
        levelId: ref.levelId,
        facilityId: ref.facilityId,
        floor: ref.floor,
        workspaceId: ref.workspaceId,
      },
      georeference: { origin, metersLat, metersLng },
    },
  }).room;
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
/** The saved layout for drawing the room, or null when there is none or it
    can't be read (the seat map then falls back to its stand-in plan). */
export function savedLayout(value: unknown): LayoutDocument | null {
  try {
    return readLayout(value);
  } catch {
    return null;
  }
}
