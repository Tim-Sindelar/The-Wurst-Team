import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import polygonClipping from 'polygon-clipping';
import { useMap, useMapEvents } from 'react-leaflet';
import {
  intersects,
  loadLevel,
  type FloorIndex,
  type LevelPlan,
  type LineLayer,
  type Room,
  type RoomKind,
} from '../floors/floorData';
import type { RoomRef } from '../domain/types';
import { outlineToLatLngs } from './geo';
import {
  dropSmallLines,
  mergeParallelEdges,
  metersPerPixel,
  partPathOptions,
  polygonsSmallerThan,
  roundLines,
  roundPolygons,
  simplifyLines,
  type MinimalStyle,
  type OccupancyStyle,
  type PartKey,
} from './minimalStyle';
import type { RoomInfo } from '../roomFeatures';
import { liftRings, type BuildingGroup } from './buildingGroups';

/** Rooms are drawn from this zoom level on, walls and doors from LINE_ZOOM. */
export const ROOM_ZOOM = 18;
export const LINE_ZOOM = 19;
const LABEL_ZOOM = 19;
export const OUTLINE_ZOOM = 15;

export type Theme = 'light' | 'dark';

const ROOM_FILL: Record<Theme, Record<RoomKind, string>> = {
  light: {
    library: '#215caf',
    teaching: '#f1e6c6',
    study: '#d9ebd0',
    office: '#eef0f4',
    lab: '#e6def2',
    circulation: '#ffffff',
    stairs: '#d6dae1',
    sanitary: '#d7e9f2',
    food: '#f4dccd',
    outdoor: '#e3eeda',
    service: '#e9e9e9',
    other: '#f3f3f4',
  },
  dark: {
    library: '#4c8dff',
    teaching: '#4a4330',
    study: '#2f4434',
    office: '#2a2f3a',
    lab: '#3a3350',
    circulation: '#232832',
    stairs: '#3a404c',
    sanitary: '#2c4250',
    food: '#4d3a30',
    outdoor: '#2b3d2e',
    service: '#30343c',
    other: '#292e37',
  },
};

export const LINE_STYLE: Record<Theme, Record<LineLayer, L.PolylineOptions>> = {
  light: {
    wall: { color: '#3c4450', weight: 1.2, opacity: 0.9 },
    door: { color: '#8a94a3', weight: 0.8, opacity: 0.9 },
    stair: { color: '#9aa3ae', weight: 0.6, opacity: 0.9 },
  },
  dark: {
    wall: { color: '#aab3c2', weight: 1.2, opacity: 0.85 },
    door: { color: '#6d7788', weight: 0.8, opacity: 0.9 },
    stair: { color: '#5b6474', weight: 0.6, opacity: 0.9 },
  },
};

export const BUILDING_STYLE: Record<
  Theme,
  {
    color: string;
    fillColor: string;
    fillOpacity: number;
    levelColor: string;
    levelFill: string;
  }
> = {
  light: {
    color: '#b9c0cb',
    fillColor: '#dfe3ea',
    fillOpacity: 0.5,
    levelColor: '#5a6372',
    levelFill: '#fbfbfc',
  },
  dark: {
    color: '#3d4553',
    fillColor: '#2a303b',
    fillOpacity: 0.6,
    levelColor: '#8792a5',
    levelFill: '#1e232c',
  },
};

export const LINE_PART: Record<LineLayer, PartKey> = {
  wall: 'walls',
  door: 'doors',
  stair: 'stairs',
};

const PANES = {
  buildings: ['floor-buildings', 340],
  rooms: ['floor-rooms', 350],
  lines: ['floor-lines', 360],
  labels: ['floor-labels', 370],
} as const;

interface Props {
  theme: Theme;
  index: FloorIndex;
  floor: number;
  /** PolyMaps room id → library id, for highlighting and selecting library rooms. */
  libraryRooms: Map<string, string>;
  selectedLibraryId: string | null;
  onSelectLibrary: (libraryId: string) => void;
  /** Room selection mode (admin): clicking any room toggles it instead of selecting its workspace. */
  picking: boolean;
  pickedRooms: ReadonlySet<string>;
  onPickRoom: (room: RoomRef) => void;
  /** Minimal render mode style; null draws the detailed plan. */
  minimal: MinimalStyle | null;
  /** Live room mode: ETH rooms by PolyMaps unit id, with their status; null when off. */
  ethRooms: ReadonlyMap<string, RoomInfo> | null;
  /** Colors rooms by status when set. */
  occupancyStyle: OccupancyStyle | null;
  /** Writes room number and seats on the ETH rooms. */
  roomLabels: boolean;
  /** ETH room whose details are open, outlined. */
  selectedEthRoom: string | null;
  /** Clicking an ETH room; null when room details are off. */
  onEthRoomClick: ((ethId: string) => void) | null;
  /** Mensa rooms (datasets/mensa/rooms.json): all of them while the mensa layer is on, else only those of a workspace. */
  mensaRooms: ReadonlyMap<string, MensaRoom>;
  selectedMensaId: string | null;
  onSelectMensa: (mensaId: string) => void;
  /** 3D view: this group's part of the floor is drawn `dLat` degrees further north, with the group's outline (see Floors3D). */
  lift: { group: BuildingGroup; dLat: number } | null;
}

/** A PolyMaps room belonging to a mensa. */
export interface MensaRoom {
  mensaId: string;
  name: string;
  color: string;
}

interface RoomLayer {
  poly: L.Polygon;
  kind: RoomKind;
  libraryId: string | null;
  mensa: MensaRoom | null;
}

/**
 * Draws the ETH floor plans for one floor: every building's footprint, the
 * outline of the levels on that floor and, when zoomed in, rooms (colored by
 * use, library rooms highlighted) plus walls, doors and stairs. Level files
 * are loaded lazily for the levels in view.
 */
export function FloorLayer({
  theme,
  index,
  floor,
  libraryRooms,
  selectedLibraryId,
  onSelectLibrary,
  picking,
  pickedRooms,
  onPickRoom,
  minimal,
  ethRooms,
  occupancyStyle,
  roomLabels,
  selectedEthRoom,
  onEthRoomClick,
  mensaRooms,
  selectedMensaId,
  onSelectMensa,
  lift,
}: Props) {
  const map = useMap();
  const [view, setView] = useState(() => ({
    bounds: map.getBounds(),
    zoom: map.getZoom(),
  }));
  useMapEvents({
    moveend: () => setView({ bounds: map.getBounds(), zoom: map.getZoom() }),
  });

  const renderers = useMemo(() => {
    const make = (
      [name, z]: readonly [string, number],
      interactive = false,
    ) => {
      if (!map.getPane(name)) {
        const pane = map.createPane(name);
        pane.style.zIndex = String(z);
        // A canvas covers the whole map, so non-interactive ones must let events through to the rooms below.
        if (!interactive) pane.style.pointerEvents = 'none';
      }
      return L.canvas({ pane: name, padding: 0.3 });
    };
    if (!map.getPane(PANES.labels[0])) {
      const pane = map.createPane(PANES.labels[0]);
      pane.style.zIndex = String(PANES.labels[1]);
      pane.style.pointerEvents = 'none';
    }
    return {
      buildings: make(PANES.buildings),
      rooms: make(PANES.rooms, true),
      lines: make(PANES.lines),
    };
  }, [map]);

  const radius = minimal?.cornerRadius ?? 0;
  const minSize = minimal?.minSize ?? 0;
  const mergeDistance = minimal?.mergeDistance ?? 0;
  const mergeAngle = minimal?.mergeAngle ?? 0;
  const simplify = minimal?.simplify ?? 0;

  // Footprints of all buildings, always visible as context.
  useEffect(() => {
    if (minimal && !minimal.parts.buildings.show) return;
    const style = minimal
      ? partPathOptions(minimal, 'buildings')
      : {
          color: BUILDING_STYLE[theme].color,
          weight: 1,
          fillColor: BUILDING_STYLE[theme].fillColor,
          fillOpacity: BUILDING_STYLE[theme].fillOpacity,
        };
    const group = L.layerGroup(
      index.facilities
        .map((f) => outlineToLatLngs(f.outline))
        .filter((polys) => !polygonsSmallerThan(polys, minSize))
        .map((polys) =>
          L.polygon(roundPolygons(polys, radius), {
            renderer: renderers.buildings,
            interactive: false,
            ...style,
          }),
        ),
    ).addTo(map);
    return () => void group.remove();
  }, [map, index, renderers, theme, minimal, radius, minSize]);

  const isLifted = (facilityId: string) =>
    !!lift && lift.group.facilityIds.has(facilityId);

  const floorLevels = useMemo(
    () => index.levels.filter((l) => l.floor === floor),
    [index, floor],
  );

  // Outlines of the levels on the selected floor.
  useEffect(() => {
    if (view.zoom < OUTLINE_ZOOM || (minimal && !minimal.parts.levels.show))
      return;
    const style = minimal
      ? partPathOptions(minimal, 'levels')
      : {
          color: BUILDING_STYLE[theme].levelColor,
          weight: 1.5,
          fillColor: BUILDING_STYLE[theme].levelFill,
          fillOpacity: 0.9,
        };
    // A lifted group shows its one outline instead of its levels' own.
    const lifted = lift && floorLevels.some((l) => isLifted(l.facilityId));
    const group = L.layerGroup(
      [
        ...floorLevels
          .filter((l) => !isLifted(l.facilityId))
          .map((l) => outlineToLatLngs(l.outline)),
        ...(lifted ? [liftRings(lift.group.outline(), lift.dLat)] : []),
      ]
        .filter((polys) => !polygonsSmallerThan(polys, minSize))
        .map((polys) =>
          L.polygon(roundPolygons(polys, radius), {
            renderer: renderers.buildings,
            interactive: false,
            ...style,
          }),
        ),
    ).addTo(map);
    return () => void group.remove();
  }, [
    map,
    floorLevels,
    renderers,
    theme,
    view.zoom >= OUTLINE_ZOOM,
    lift,
    minimal,
    radius,
    minSize,
  ]);

  // Rooms and lines of the levels in view, loaded on demand.
  const visibleIds = useMemo(() => {
    if (view.zoom < ROOM_ZOOM) return [];
    const b = view.bounds.pad(0.2);
    const box = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
    return floorLevels
      .filter((l) => {
        const d = isLifted(l.facilityId) ? lift!.dLat : 0;
        return intersects(
          [l.bbox[0], l.bbox[1] + d, l.bbox[2], l.bbox[3] + d],
          box,
        );
      })
      .map((l) => l.id);
  }, [floorLevels, view, lift]);
  const visibleKey = visibleIds.join('|');

  const [plans, setPlans] = useState<Map<string, LevelPlan>>(new Map());
  useEffect(() => {
    let cancelled = false;
    for (const id of visibleIds) {
      if (plans.has(id)) continue;
      loadLevel(id).then(
        (plan) => !cancelled && setPlans((prev) => new Map(prev).set(id, plan)),
        (err) => console.warn(`Floor plan ${id} failed to load`, err),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [visibleKey]);

  // The plans as drawn: the lifted group's moved north.
  const shownPlans = useMemo(() => {
    if (!lift) return plans;
    const out = new Map<string, LevelPlan>();
    for (const [id, plan] of plans)
      out.set(
        id,
        lift.group.levels.some((l) => l.id === id)
          ? liftPlan(plan, lift.dLat)
          : plan,
      );
    return out;
  }, [plans, lift]);

  // Callbacks change every render; the layers read them through a ref.
  const handlers = useRef({
    onSelectLibrary,
    onPickRoom,
    picking,
    onEthRoomClick,
    onSelectMensa,
  });
  handlers.current = {
    onSelectLibrary,
    onPickRoom,
    picking,
    onEthRoomClick,
    onSelectMensa,
  };
  // Statuses change every minute; the layers only rebuild when the set of ETH rooms changes,
  // tooltips and styles read the current statuses through this ref.
  const ethRef = useRef(ethRooms);
  ethRef.current = ethRooms;
  const ethKey = useMemo(
    () => (ethRooms ? [...ethRooms.keys()].sort().join('|') : ''),
    [ethRooms],
  );
  const levelsById = useMemo(
    () => new Map(index.levels.map((l) => [l.id, l])),
    [index],
  );

  const roomLayers = useRef(new Map<string, RoomLayer>());
  const fillLayers = useRef(new Map<string, L.Polygon>());
  useEffect(() => {
    const roomGroup = L.layerGroup().addTo(map);
    roomLayers.current = new Map();
    const libraryRings = new Map<string, [number, number][][][]>();
    for (const id of visibleIds) {
      const plan = shownPlans.get(id);
      const level = levelsById.get(id);
      if (!plan || !level) continue;
      for (const room of plan.rooms) {
        const libraryId = libraryRooms.get(room.id) ?? null;
        const eth = ethRef.current?.get(room.id) ?? null;
        const mensa = mensaRooms.get(room.id) ?? null;
        // Workspace, mensa and ETH rooms stay regardless of size, they are click targets.
        if (
          !libraryId &&
          !mensa &&
          !eth &&
          polygonsSmallerThan(room.rings, minSize)
        )
          continue;
        const poly = L.polygon(roundPolygons(room.rings, radius), {
          renderer: renderers.rooms,
          ...(asMensaRoom(
            mensa,
            libraryId,
            selectedMensaId,
            pickedRooms.has(room.id),
            picking,
            !!(eth && occupancyStyle),
          )
            ? mensaStyle(
                mensa!,
                libraryId && libraryId === selectedLibraryId
                  ? mensa!.mensaId
                  : selectedMensaId,
              )
            : roomLayerStyle(
                theme,
                room.kind,
                libraryId,
                selectedLibraryId,
                pickedRooms.has(room.id),
                minimal,
                picking,
              )),
        });
        const name = room.name || room.id;
        poly.on('click', (e) => {
          const h = handlers.current;
          if (h.picking) {
            L.DomEvent.stop(e);
            h.onPickRoom({
              id: room.id,
              name,
              levelId: level.id,
              facilityId: level.facilityId,
              floor: level.floor,
              area: room.area,
              center: roomCenter(room),
              address:
                [
                  index.facilities.find((x) => x.id === level.facilityId)
                    ?.address,
                  room.name,
                ]
                  .filter(Boolean)
                  .join(', ') || null,
            });
          } else {
            const info = ethRef.current?.get(room.id);
            // One target per tap: the ETH room if it has one, else its workspace or mensa.
            if (info && h.onEthRoomClick) h.onEthRoomClick(info.room.id);
            else if (libraryId) h.onSelectLibrary(libraryId);
            else if (mensa) h.onSelectMensa(mensa.mensaId);
          }
        });
        roomLayers.current.set(room.id, {
          poly,
          kind: room.kind,
          libraryId,
          mensa,
        });
        roomGroup.addLayer(poly);
        // A workspace room that is also a mensa room keeps the mensa's color, outside the workspace fill.
        if (libraryId && !(mensa && !picking))
          (
            libraryRings.get(libraryId) ??
            libraryRings.set(libraryId, []).get(libraryId)!
          ).push(...room.rings);
      }
    }
    // A workspace's rooms are filled as one merged shape, so overlapping rooms don't add up their alpha.
    fillLayers.current = new Map();
    for (const [libraryId, polys] of libraryRings) {
      let merged: [number, number][][][];
      try {
        const [first, ...rest] = polys.map((rings) =>
          rings.map((r) =>
            r.map(([lat, lng]) => [lng, lat] as [number, number]),
          ),
        );
        merged = polygonClipping
          .union(
            first as polygonClipping.Geom,
            ...(rest as polygonClipping.Geom[]),
          )
          .map((poly) =>
            poly.map((ring) =>
              ring
                .slice(0, -1)
                .map(([lng, lat]) => [lat, lng] as [number, number]),
            ),
          );
      } catch {
        merged = polys;
      }
      const fill = L.polygon(roundPolygons(merged, radius), {
        renderer: renderers.rooms,
        interactive: false,
        ...roomStyle(
          theme,
          'library',
          libraryId,
          selectedLibraryId,
          false,
          minimal,
          picking,
        ),
      });
      fillLayers.current.set(libraryId, fill);
      roomGroup.addLayer(fill);
    }
    return () => void roomGroup.remove();
    // Selection changes are applied by restyling below instead of rebuilding.
  }, [
    map,
    renderers,
    shownPlans,
    visibleKey,
    libraryRooms,
    levelsById,
    theme,
    radius,
    minSize,
    ethKey,
    mensaRooms,
  ]);

  useEffect(() => {
    for (const [
      roomId,
      { poly, kind, libraryId, mensa },
    ] of roomLayers.current) {
      const picked = pickedRooms.has(roomId);
      const info = ethRooms?.get(roomId);
      poly.setStyle(
        asMensaRoom(
          mensa,
          libraryId,
          selectedMensaId,
          picked,
          picking,
          !!(info && occupancyStyle),
        )
          ? mensaStyle(
              mensa!,
              libraryId && libraryId === selectedLibraryId
                ? mensa!.mensaId
                : selectedMensaId,
            )
          : info && occupancyStyle && !picked
            ? occupancyPath(
                occupancyStyle,
                info,
                info.room.id === selectedEthRoom,
              )
            : info && info.room.id === selectedEthRoom && !picked
              ? {
                  ...roomLayerStyle(
                    theme,
                    kind,
                    libraryId,
                    selectedLibraryId,
                    picked,
                    minimal,
                    picking,
                  ),
                  stroke: true,
                  color: SELECTED_ROOM[theme],
                  weight: 2.5,
                  opacity: 1,
                }
              : roomLayerStyle(
                  theme,
                  kind,
                  libraryId,
                  selectedLibraryId,
                  picked,
                  minimal,
                  picking,
                ),
      );
    }
    for (const [libraryId, fill] of fillLayers.current) {
      fill.setStyle(
        roomStyle(
          theme,
          'library',
          libraryId,
          selectedLibraryId,
          false,
          minimal,
          picking,
        ),
      );
    }
    // The selected mensa's rooms go above the workspace fills, so rooms shared with a workspace show the mensa.
    for (const { poly, mensa } of roomLayers.current.values()) {
      if (mensa && mensa.mensaId === selectedMensaId && !picking)
        poly.bringToFront();
    }
  }, [
    selectedLibraryId,
    pickedRooms,
    shownPlans,
    visibleKey,
    libraryRooms,
    theme,
    minimal,
    picking,
    radius,
    ethRooms,
    occupancyStyle,
    selectedEthRoom,
    ethKey,
    mensaRooms,
    selectedMensaId,
  ]);

  // Room number and seats on each ETH room in view (one label per room, on its largest part).
  const showLabels = roomLabels && view.zoom >= LABEL_ZOOM && !!ethRooms;
  useEffect(() => {
    if (!showLabels) return;
    const group = L.layerGroup().addTo(map);
    const best = new Map<string, { room: Room; area: number }>();
    for (const id of visibleIds) {
      for (const room of shownPlans.get(id)?.rooms ?? []) {
        const info = ethRef.current?.get(room.id);
        if (!info) continue;
        const prev = best.get(info.room.id);
        if (!prev || room.area > prev.area)
          best.set(info.room.id, { room, area: room.area });
      }
    }
    for (const [ethId, { room }] of best) {
      const info = ethRef.current!.get(room.id)!;
      const seats = info.room.seats ?? info.room.workplaces;
      const short = ethId.split(' ').slice(1).join(' ');
      group.addLayer(
        L.marker(roomCenter(room), {
          pane: PANES.labels[0],
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: '',
            html: `<div class="room-label"><b>${escapeHtml(short)}</b>${seats != null ? `<span>${seats} seats</span>` : ''}</div>`,
            iconSize: [0, 0],
          }),
        }),
      );
    }
    return () => void group.remove();
  }, [map, showLabels, shownPlans, visibleKey, ethKey]);

  const showLines = view.zoom >= LINE_ZOOM;
  // Line geometry per level and layer: simplified, parallel edges merged, small pieces dropped, corners rounded.
  // Kept apart from the styling so color tweaks don't redo the merge. While merging, the lines are
  // simplified here (at the current zoom, like Leaflet's smoothFactor) so the merge sees the result.
  const presimplify = mergeDistance > 0 && simplify > 0;
  const simplifyZoom = presimplify ? view.zoom : null;
  const levelLines = useMemo(() => {
    const out = new Map<string, [LineLayer, L.LatLngTuple[][]][]>();
    if (!showLines) return out;
    for (const id of visibleIds) {
      const plan = shownPlans.get(id);
      if (!plan) continue;
      out.set(
        id,
        (Object.entries(plan.lines) as [LineLayer, [number, number][][]][]).map(
          ([layer, lines]) => {
            const tolerance =
              simplifyZoom === null || !lines[0]?.[0]
                ? 0
                : simplify * metersPerPixel(lines[0][0][0], simplifyZoom);
            const merged = mergeParallelEdges(
              simplifyLines(lines, tolerance),
              mergeDistance,
              mergeAngle,
            );
            return [layer, roundLines(dropSmallLines(merged, minSize), radius)];
          },
        ),
      );
    }
    return out;
  }, [
    shownPlans,
    visibleKey,
    showLines,
    radius,
    minSize,
    mergeDistance,
    mergeAngle,
    simplify,
    simplifyZoom,
  ]);

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    for (const layers of levelLines.values()) {
      for (const [layer, lines] of layers) {
        if (!lines.length || (minimal && !minimal.parts[LINE_PART[layer]].show))
          continue;
        const style = minimal
          ? partPathOptions(minimal, LINE_PART[layer])
          : LINE_STYLE[theme][layer];
        // Already simplified above, so Leaflet must not simplify the merged result again.
        if (presimplify) style.smoothFactor = 0;
        group.addLayer(
          L.polyline(lines, {
            ...style,
            renderer: renderers.lines,
            interactive: false,
          }),
        );
      }
    }
    return () => void group.remove();
  }, [map, renderers, levelLines, theme, minimal, presimplify]);

  return null;
}

const liftedPlans = new WeakMap<LevelPlan, { dLat: number; plan: LevelPlan }>();

/** A plan moved `dLat` degrees north. */
function liftPlan(plan: LevelPlan, dLat: number): LevelPlan {
  const cached = liftedPlans.get(plan);
  if (cached?.dLat === dLat) return cached.plan;
  const lines: LevelPlan['lines'] = {};
  for (const [layer, list] of Object.entries(plan.lines) as [
    LineLayer,
    [number, number][][],
  ][])
    lines[layer] = liftRings([list], dLat)[0];
  const out = {
    ...plan,
    rooms: plan.rooms.map((r) => ({ ...r, rings: liftRings(r.rings, dLat) })),
    lines,
  };
  liftedPlans.set(plan, { dLat, plan: out });
  return out;
}

const SELECTED_ROOM: Record<Theme, string> = {
  light: '#1c2430',
  dark: '#ffffff',
};

/** A room colored by its booking status. */
export function occupancyPath(
  style: OccupancyStyle,
  info: RoomInfo,
  selected: boolean,
): L.PolylineOptions {
  const color = style[info.state.status];
  return {
    ...DETAILED_PATH,
    stroke: selected || style.weight > 0,
    color: selected ? style.selected : color,
    weight: selected ? Math.max(2.5, style.weight + 2) : style.weight,
    opacity: 1,
    fill: true,
    fillColor: color,
    fillOpacity: style.fill,
  };
}

/**
 * Whether a room is drawn as a mensa room. A workspace that is also a mensa (study space outside meal
 * times) is always drawn in the mensa's color; rooms showing a live booking status keep that look unless
 * their mensa is selected.
 */
export function asMensaRoom(
  mensa: MensaRoom | null,
  libraryId: string | null,
  selectedMensaId: string | null,
  picked: boolean,
  picking: boolean,
  occupancy: boolean,
) {
  if (!mensa || picked || picking) return false;
  return mensa.mensaId === selectedMensaId || !!libraryId || !occupancy;
}

/** A mensa room, in the mensa dataset's color: tinted, outlined when its mensa is selected. */
export function mensaStyle(
  mensa: MensaRoom,
  selectedMensaId: string | null,
): L.PolylineOptions {
  const selected = mensa.mensaId === selectedMensaId;
  return {
    ...DETAILED_PATH,
    stroke: true,
    color: mensa.color,
    weight: selected ? 2.5 : 1,
    opacity: selected ? 1 : 0.7,
    fillColor: mensa.color,
    fillOpacity: selected ? 0.5 : 0.28,
  };
}

/** Style of a room's own polygon: workspace rooms are only hit targets, their fill comes from the merged shape. */
function roomLayerStyle(
  theme: Theme,
  kind: RoomKind,
  libraryId: string | null,
  selectedLibraryId: string | null,
  picked: boolean,
  minimal: MinimalStyle | null,
  picking: boolean,
): L.PolylineOptions {
  const style = roomStyle(
    theme,
    kind,
    libraryId,
    selectedLibraryId,
    picked,
    minimal,
    picking,
  );
  return libraryId && !picked ? { ...style, fillOpacity: 0 } : style;
}

/** Resets what a minimal style may have changed when restyling back to the detailed plan. */
const DETAILED_PATH: L.PolylineOptions = {
  stroke: true,
  fill: true,
  opacity: 1,
  lineJoin: 'round',
  lineCap: 'round',
  smoothFactor: 1,
};

export function roomStyle(
  theme: Theme,
  kind: RoomKind,
  libraryId: string | null,
  selectedLibraryId: string | null,
  picked: boolean,
  minimal: MinimalStyle | null,
  picking: boolean,
): L.PolylineOptions {
  if (picked)
    return {
      ...DETAILED_PATH,
      color: '#b85a00',
      weight: 2.5,
      fillColor: '#f08a24',
      fillOpacity: 0.6,
    };
  if (minimal) {
    const lib = minimal.parts.libraryRooms;
    if (libraryId && lib.show) {
      const style = partPathOptions(minimal, 'libraryRooms');
      // No per-room border: the workspace outline marks the edge of the whole.
      if (libraryId !== selectedLibraryId) return { ...style, stroke: false };
      return {
        ...style,
        stroke: false,
        fill: true,
        fillColor: minimal.highlightCustomColor
          ? minimal.highlightColor
          : style.fillColor,
        fillOpacity: Math.min(1, lib.fill + minimal.highlightFill + 0.13),
      };
    }
    if (
      !libraryId &&
      minimal.parts.rooms.show &&
      minimal.roomKinds.includes(kind)
    )
      return partPathOptions(minimal, 'rooms');
    // Hidden rooms stay on the canvas, invisible, so tooltips, clicks and picking keep working;
    // while picking they get a faint outline so there is something to click.
    return picking
      ? {
          ...partPathOptions(minimal, 'rooms'),
          stroke: true,
          weight: 0.6,
          opacity: 0.6,
          fill: true,
          fillOpacity: 0,
        }
      : { stroke: false, fill: true, fillOpacity: 0 };
  }
  if (libraryId) {
    const selected = libraryId === selectedLibraryId;
    const c = theme === 'dark' ? '#4c8dff' : '#215caf';
    return {
      ...DETAILED_PATH,
      stroke: false,
      fillColor: c,
      fillOpacity: selected ? 0.5 : 0.3,
    };
  }
  return {
    ...DETAILED_PATH,
    color: theme === 'dark' ? '#3d4553' : '#c3cad4',
    weight: 0.6,
    fillColor: ROOM_FILL[theme][kind],
    fillOpacity: 0.85,
  };
}

/** Area-weighted centroid of the room's largest polygon (outer ring), as a map position. */
function roomCenter(room: Room): RoomRef['center'] {
  let best = { area: -1, lat: 0, lng: 0 };
  for (const [outer] of room.rings) {
    let a = 0,
      cx = 0,
      cy = 0;
    for (let i = 0; i < outer.length; i++) {
      const [y0, x0] = outer[i];
      const [y1, x1] = outer[(i + 1) % outer.length];
      const f = x0 * y1 - x1 * y0;
      a += f;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
    }
    const area = Math.abs(a / 2);
    if (area > best.area) {
      best =
        area > 1e-14
          ? { area, lat: cy / (3 * a), lng: cx / (3 * a) }
          : {
              area,
              lat: outer.reduce((s, p) => s + p[0], 0) / outer.length,
              lng: outer.reduce((s, p) => s + p[1], 0) / outer.length,
            };
    }
  }
  return { lat: +best.lat.toFixed(7), lng: +best.lng.toFixed(7) };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
