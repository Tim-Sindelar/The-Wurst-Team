import { useEffect, useState } from 'react';
import type L from 'leaflet';
import type { MultiPolygon } from 'geojson';
import polygonClipping from 'polygon-clipping';
import { useMap, useMapEvents } from 'react-leaflet';
import {
  singleFloorLabel,
  type FloorIndex,
  type LevelInfo,
} from '../floors/floorData';
import { outlineToLatLngs } from './geo';

// The 3D view stacks one building group at a time: the buildings inside one
// building zoom zone of navigation.json (the zones only hold outlines, so the
// grouping is written out here). A building outside every zone is a group of
// its own. Every floor of a group is drawn with the same outline, the union of
// all its buildings and levels, and the stack stands on the group's ground
// floor, which keeps its real place on the map.

const GROUPS: Record<string, string[]> = {
  // nav-47f521e1
  HG: ['HG', 'MM', 'GEP'],
  // nav-a91a3efe
  ML: [
    'ML',
    'NO',
    'NW',
    'TAN',
    'LEE',
    'LEO',
    'CLA',
    'CLD',
    'CLE',
    'CLF',
    'CLT',
    'SOQ',
  ],
  // nav-9a42d1f3
  CAB: ['CAB', 'CNB', 'CNS', 'CHN', 'STW', 'LFG', 'LFH', 'LFO', 'LFV', 'LFW'],
  // nav-e010f185
  ETZ: ['ETZ', 'ETA', 'ETF', 'ETL', 'GLC'],
  // nav-cb67d774
  IFW: ['IFW', 'RZ'],
  // nav-b459d84f
  HI: ['HIA', 'HIB', 'HIF', 'HIG', 'HIL', 'HIN', 'HIT', 'HDB', 'HKK'],
  // nav-5ec60d11
  HC: ['HCI', 'HCP', 'HWA', 'HWB', 'HWC', 'HPH', 'HPS', 'HPV', 'HXE'],
  // nav-f77ba8b6
  HP: ['HPF', 'HPG', 'HPK', 'HPL', 'HPM', 'HPP', 'HPT', 'HPW', 'HPY', 'HPZ'],
};

const GROUP_OF = new Map<string, string>(
  Object.entries(GROUPS).flatMap(([group, ids]) =>
    ids.map((id) => [`ETH.${id}`, `group:${group}`] as const),
  ),
);

/** Group id of a building: its zone's group, or the building itself. */
export const groupOf = (facilityId: string) =>
  GROUP_OF.get(facilityId) ?? facilityId;

/** Meters per degree of latitude: a floor is lifted north by spacing / this. */
const M_PER_DEG_LAT = 110_574;

/** Below this zoom a storey is only a few pixels high: nothing is stacked. */
export const STACK_ZOOM = 16;

export interface BuildingGroup {
  id: string;
  facilityIds: ReadonlySet<string>;
  levels: LevelInfo[];
  /** Floors the group's levels are on, ascending. */
  floors: number[];
  /** One floor letter per floor, the one most of the group's buildings use. */
  labels: ReadonlyMap<number, string>;
  /** The floor that stays in place: where most of its buildings have their "E" (0 without one). */
  ground: number;
  /** [west, south, east, north] of the outline. */
  bbox: [number, number, number, number];
  /** One outline for every floor: all buildings and levels of the group merged, as [lat, lng]. */
  outline: () => L.LatLngTuple[][][];
}

export function buildGroups(index: FloorIndex): Map<string, BuildingGroup> {
  const facilities = new Map<string, MultiPolygon[]>();
  const levels = new Map<string, LevelInfo[]>();
  for (const f of index.facilities)
    (
      facilities.get(groupOf(f.id)) ??
      facilities.set(groupOf(f.id), []).get(groupOf(f.id))!
    ).push(f.outline);
  for (const l of index.levels)
    (
      levels.get(groupOf(l.facilityId)) ??
      levels.set(groupOf(l.facilityId), []).get(groupOf(l.facilityId))!
    ).push(l);

  const out = new Map<string, BuildingGroup>();
  for (const [id, groupLevels] of levels) {
    const shapes = [
      ...(facilities.get(id) ?? []),
      ...groupLevels.map((l) => l.outline),
    ];
    const floors = [...new Set(groupLevels.map((l) => l.floor))].sort(
      (a, b) => a - b,
    );
    const bbox: BuildingGroup['bbox'] = [
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
    ];
    for (const mp of shapes)
      for (const poly of mp.coordinates)
        for (const [lng, lat] of poly[0]) {
          bbox[0] = Math.min(bbox[0], lng);
          bbox[1] = Math.min(bbox[1], lat);
          bbox[2] = Math.max(bbox[2], lng);
          bbox[3] = Math.max(bbox[3], lat);
        }
    let outline: L.LatLngTuple[][][] | null = null;
    out.set(id, {
      id,
      facilityIds: new Set(groupLevels.map((l) => l.facilityId)),
      levels: groupLevels,
      floors,
      labels: new Map(
        floors.map((f) => [f, singleFloorLabel(f, groupLevels, null)]),
      ),
      ground: groundFloor(groupLevels),
      bbox,
      outline: () => (outline ??= mergeOutlines(shapes)),
    });
  }
  return out;
}

/** The floor most buildings of the group have their "E" (Erdgeschoss) on; ties go to the one nearest 0. */
function groundFloor(levels: LevelInfo[]): number {
  const votes = new Map<number, number>();
  for (const f of new Set(
    levels
      .filter((l) => l.label === 'E')
      .map((l) => `${l.facilityId}|${l.floor}`),
  )) {
    const floor = Number(f.split('|')[1]);
    votes.set(floor, (votes.get(floor) ?? 0) + 1);
  }
  let best = 0;
  let bestVotes = 0;
  for (const [floor, n] of votes)
    if (n > bestVotes || (n === bestVotes && Math.abs(floor) < Math.abs(best)))
      [best, bestVotes] = [floor, n];
  return best;
}

function mergeOutlines(shapes: MultiPolygon[]): L.LatLngTuple[][][] {
  const polys = shapes.flatMap(
    (mp) => mp.coordinates as polygonClipping.Polygon[],
  );
  try {
    const [first, ...rest] = polys;
    return outlineToLatLngs({
      type: 'MultiPolygon',
      coordinates: polygonClipping.union(
        first,
        ...rest,
      ) as MultiPolygon['coordinates'],
    });
  } catch {
    return shapes.flatMap(outlineToLatLngs);
  }
}

/** How far north (in degrees of latitude) a floor of the group is drawn. */
export const floorLift = (
  group: Pick<BuildingGroup, 'ground'>,
  floor: number,
  spacing: number,
) => ((floor - group.ground) * spacing) / M_PER_DEG_LAT;

/** [lat, lng] rings moved north by `dLat`. */
export const liftRings = (
  polys: L.LatLngTuple[][][],
  dLat: number,
): [number, number][][][] =>
  polys.map((rings) =>
    rings.map((ring) => ring.map(([lat, lng]) => [lat + dLat, lng])),
  );

/**
 * The group in focus: the one whose outline box holds the map center, else
 * the one nearest to it among those in view. Null while zoomed out below STACK_ZOOM.
 */
export function useBuildingGroup(
  groups: ReadonlyMap<string, BuildingGroup> | null,
): BuildingGroup | null {
  const map = useMap();
  const pick = () =>
    groups && map.getZoom() >= STACK_ZOOM
      ? groupAt(groups, map.getCenter(), map.getBounds())
      : null;
  const [group, setGroup] = useState(pick);
  useMapEvents({ moveend: () => setGroup(pick()) });
  useEffect(() => setGroup(pick()), [groups]);
  return group;
}

function groupAt(
  groups: ReadonlyMap<string, BuildingGroup>,
  center: L.LatLng,
  bounds: L.LatLngBounds,
): BuildingGroup | null {
  const { lat, lng } = center;
  const kx = Math.cos((lat * Math.PI) / 180);
  let best: BuildingGroup | null = null;
  let bestD = Infinity;
  for (const g of groups.values()) {
    const [w, s, e, n] = g.bbox;
    if (w > bounds.getEast() || e < bounds.getWest()) continue;
    if (s > bounds.getNorth() || n < bounds.getSouth()) continue;
    const dx = Math.max(w - lng, 0, lng - e) * kx;
    const dy = Math.max(s - lat, 0, lat - n);
    // Inside several boxes: the smaller box is the closer fit.
    const d =
      dx === 0 && dy === 0 ? -1 / ((e - w) * kx * (n - s)) : Math.hypot(dx, dy);
    if (d < bestD) [best, bestD] = [g, d];
  }
  return best;
}
