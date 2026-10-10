import { useEffect, useMemo, useState, type ReactNode } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Polygon,
  ScaleControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { LatLng, MultiPolygon, OccupancyData } from '../domain/types';
import { occupancyOf } from '../domain/operations';
import type { Selection } from '../state';
import {
  libraryIcon,
  occupancyLevel,
  seatIcon,
  tableIcon,
  type OccupancyLevel,
} from './icons';
import { outlineToLatLngs } from './geo';
import { FloorLayer, type MensaRoom, type Theme } from './FloorLayer';
import { VectorBasemap, OPENFREEMAP_ATTRIBUTION } from './VectorBasemap';
import { FloorPicker } from './FloorPicker';
import { Floors3D } from './Floors3D';
import {
  libraryFloorLabel,
  loadLibraryOutlineRoomKeys,
  loadLibraryOutlines,
  outlineFromRooms,
  roomsKey,
  type FloorIndex,
} from '../floors/floorData';
import {
  partPathOptions,
  roundPolygons,
  type MinimalStyle,
  type OccupancyStyle,
  type View3DStyle,
} from './minimalStyle';
import type { RoomInfo } from '../roomFeatures';
import type { NavigationConfig } from '../domain/navigation';
import { NavZones } from './NavZones';
import {
  buildGroups,
  floorLift,
  liftRings,
  STACK_ZOOM,
  useBuildingGroup,
  type BuildingGroup,
} from './buildingGroups';

const OUTLINE_COLORS: Record<OccupancyLevel, string> = {
  none: '#215caf',
  ok: '#2e9d5b',
  low: '#e0a020',
  full: '#d0453c',
};

/** Tables and seats are only rendered from this zoom level on. */
export const DETAIL_ZOOM = 18;
const MAX_ZOOM = 22;
const INITIAL_ZOOM = 14;

export interface FlyTarget {
  position: LatLng;
  zoom: number;
  /** When set, the view fits these bounds instead of using position/zoom. */
  bounds?: L.LatLngBoundsLiteral;
  /** Changes on every request so flying to the same place twice works. */
  nonce: number;
}

interface Props {
  theme: Theme;
  data: OccupancyData;
  selection: Selection;
  flyTarget: FlyTarget | null;
  /** Floor plans; null while loading or when unavailable. */
  floorIndex: FloorIndex | null;
  floor: number;
  onFloorChange: (floor: number) => void;
  onSelect: (sel: Selection) => void;
  onZoomChange: (zoom: number) => void;
  /** Minimal render mode style; null renders the detailed map. */
  minimal: MinimalStyle | null;
  /** Click-to-zoom zones; null while loading. */
  navigation: NavigationConfig | null;
  /** The start view (and the home button) frames these: both campuses. */
  homePositions: LatLng[];
  /** Live room mode (see FloorLayer). */
  ethRooms: ReadonlyMap<string, RoomInfo> | null;
  occupancyStyle: OccupancyStyle | null;
  roomLabels: boolean;
  selectedEthRoom: string | null;
  onEthRoomClick: ((ethId: string) => void) | null;
  /** Mensa rooms (see FloorLayer). */
  mensaRooms: ReadonlyMap<string, MensaRoom>;
  /** Workspaces that are also a mensa, drawn in the mensa's color: library id → mensa. */
  mensaWorkspaces: ReadonlyMap<string, MensaRoom>;
  selectedMensaId: string | null;
  onSelectMensa: (mensaId: string) => void;
  /** 3D view: the other floors stacked around the selected one; null when off. */
  view3d: View3DStyle | null;
  /** More map layers (the campus datasets), rendered inside the map. */
  children?: ReactNode;
}

const NO_ROOMS: ReadonlySet<string> = new Set();

export function MapView(props: Props) {
  const { data, selection } = props;
  // The 3D settings live in the same style object; tweaking them must not rebuild the plan layers.
  const minimalKey = props.minimal
    ? JSON.stringify({ ...props.minimal, view3d: null })
    : '';
  const minimal = useMemo(() => props.minimal, [minimalKey]);
  const labels = !minimal || minimal.basemapLabels;
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const showDetail = zoom >= DETAIL_ZOOM;
  const { floor } = props;
  /** Libraries without a floor (not in PolyMaps) are shown on every floor. */
  const onFloor = (lib: { floor: number | null }) =>
    lib.floor === null || lib.floor === floor;
  const librariesOnFloor = new Set(
    data.libraries.filter(onFloor).map((l) => l.id),
  );
  const tablesOnFloor = data.tables.filter((t) =>
    librariesOnFloor.has(t.libraryId),
  );
  const tableIdsOnFloor = new Set(tablesOnFloor.map((t) => t.id));
  const libraryRooms = useMemo(
    () =>
      new Map(
        data.libraries.flatMap((l) => l.rooms.map((r) => [r, l.id] as const)),
      ),
    [data.libraries],
  );
  // Libraries without a hand-drawn outline get one derived from their rooms.
  const [derivedOutlines, setDerivedOutlines] = useState<
    Record<string, MultiPolygon>
  >({});
  useEffect(() => void loadLibraryOutlines().then(setDerivedOutlines), []);
  // Workspaces whose rooms differ from what the pipeline built an outline for (created or changed in admin)
  // get theirs from the room polygons, so they look like the pregenerated ones.
  const [baselineKeys, setBaselineKeys] = useState<Record<
    string,
    string
  > | null>(null);
  useEffect(() => void loadLibraryOutlineRoomKeys().then(setBaselineKeys), []);
  const [roomOutlines, setRoomOutlines] = useState<
    Record<string, { key: string; outline: MultiPolygon | null }>
  >({});
  const stale = baselineKeys
    ? data.libraries.filter(
        (l) =>
          !l.outline &&
          l.rooms.length &&
          baselineKeys[l.id] !== roomsKey(l.rooms),
      )
    : [];
  const staleKey = stale.map((l) => `${l.id}=${roomsKey(l.rooms)}`).join(';');
  useEffect(() => {
    let cancelled = false;
    for (const l of stale) {
      const key = roomsKey(l.rooms);
      if (roomOutlines[l.id]?.key === key) continue;
      outlineFromRooms(l.rooms).then(
        (outline) =>
          !cancelled &&
          setRoomOutlines((prev) => ({ ...prev, [l.id]: { key, outline } })),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [staleKey]);
  const outlineOf = (lib: {
    id: string;
    outline: MultiPolygon | null;
    rooms?: string[];
  }) => {
    if (lib.outline) return lib.outline;
    if (
      baselineKeys &&
      lib.rooms?.length &&
      baselineKeys[lib.id] !== roomsKey(lib.rooms)
    ) {
      const own = roomOutlines[lib.id];
      return own && own.key === roomsKey(lib.rooms) ? own.outline : null;
    }
    return derivedOutlines[lib.id] ?? null;
  };
  // Other floors first, then this floor, the selected library on top.
  const drawOrder = (lib: { id: string; floor: number | null }) =>
    selection.libraryId === lib.id ? 2 : onFloor(lib) ? 1 : 0;
  // 3D view: the building group in focus is stacked, its floors lifted north (see Floors3D).
  const groups = useMemo(
    () => (props.floorIndex ? buildGroups(props.floorIndex) : null),
    [props.floorIndex],
  );
  const [focusGroup, setFocusGroup] = useState<BuildingGroup | null>(null);
  const stackGroup = props.view3d && zoom >= STACK_ZOOM ? focusGroup : null;
  const spacing = props.view3d?.spacing ?? 0;
  /** How far north a workspace or pin of a building's floor is drawn. */
  const liftOf = (facilityId: string | null, f: number | null) =>
    stackGroup &&
    facilityId &&
    f !== null &&
    stackGroup.facilityIds.has(facilityId)
      ? floorLift(stackGroup, f, spacing)
      : 0;
  const planLift = useMemo(
    () =>
      stackGroup
        ? { group: stackGroup, dLat: floorLift(stackGroup, floor, spacing) }
        : null,
    [stackGroup, floor, spacing],
  );
  const libraryById = new Map(data.libraries.map((l) => [l.id, l]));
  const libraryLift = (libraryId: string) => {
    const lib = libraryById.get(libraryId);
    return lib ? liftOf(lib.facilityId, lib.floor) : 0;
  };

  // In 3D, a workspace shows only on its own floor; flat, the other floors' show too.
  const shown = (lib: { floor: number | null }) =>
    !props.view3d || onFloor(lib);
  const outlinedLibraries = data.libraries
    .filter((l) => shown(l) && outlineOf(l))
    .sort((a, b) => drawOrder(a) - drawOrder(b));

  // Computed once: the initial view frames all workspaces, enabled or not (both campuses).
  // (An empty list has no bounds: fall back to the default center.)
  const [initialBounds] = useState(() =>
    props.homePositions.length
      ? L.latLngBounds(
          props.homePositions.map((p) => [p.lat, p.lng] as [number, number]),
        ).pad(0.1)
      : undefined,
  );

  return (
    <MapContainer
      // react-leaflet uses center/zoom over bounds, so only fall back to them.
      bounds={initialBounds}
      boundsOptions={{ padding: [16, 16] }}
      center={initialBounds ? undefined : [47.3925, 8.528]}
      zoom={initialBounds ? undefined : INITIAL_ZOOM}
      zoomSnap={0.25}
      maxZoom={MAX_ZOOM}
      tapTolerance={15}
      className="map"
    >
      {/* Always the clean base map. */}
      <VectorBasemap style="positron" labels={labels} />
      <AttributionText />
      <BasemapOpacity opacity={minimal ? minimal.basemapOpacity : 1} />
      <ScaleControl imperial={false} />

      <MapEvents
        onZoom={(z) => {
          setZoom(z);
          props.onZoomChange(z);
        }}
      />
      <FlyTo target={props.flyTarget} />
      <FitStart bounds={initialBounds} />

      {props.floorIndex && (
        <>
          <FloorLayer
            theme={props.theme}
            index={props.floorIndex}
            floor={floor}
            libraryRooms={libraryRooms}
            selectedLibraryId={selection.libraryId}
            onSelectLibrary={(libraryId) =>
              props.onSelect({ libraryId, tableId: null, seatId: null })
            }
            picking={false}
            pickedRooms={NO_ROOMS}
            onPickRoom={() => {}}
            minimal={minimal}
            ethRooms={props.ethRooms}
            occupancyStyle={props.occupancyStyle}
            roomLabels={props.roomLabels}
            selectedEthRoom={props.selectedEthRoom}
            onEthRoomClick={props.onEthRoomClick}
            mensaRooms={props.mensaRooms}
            selectedMensaId={props.selectedMensaId}
            onSelectMensa={props.onSelectMensa}
            lift={planLift}
          />
          {props.view3d && (
            <Floors3D
              theme={props.theme}
              index={props.floorIndex}
              group={stackGroup}
              floor={floor}
              onFloorChange={props.onFloorChange}
              style={props.view3d}
              minimal={minimal}
            />
          )}
          <FloorPicker
            index={props.floorIndex}
            floor={floor}
            libraries={data.libraries}
            onChange={props.onFloorChange}
          />
        </>
      )}

      {props.view3d && (
        <GroupTracker groups={groups} onChange={setFocusGroup} />
      )}

      {props.navigation && (
        <NavZones
          config={props.navigation}
          enabled
          highlightedZoneId={null}
          homeBounds={initialBounds}
          showHints={false}
        />
      )}

      {outlinedLibraries.map((lib) => {
        // Outlines are hidden when the minimal style switches workspaces off.
        if (minimal && !minimal.parts.workspaces.show) return null;
        const occ = occupancyOf(data, lib.id);
        const selected = selection.libraryId === lib.id;
        // A workspace that is also a mensa has the mensa's color.
        const mensaColor = props.mensaWorkspaces.get(lib.id)?.color;
        const occColor =
          mensaColor ?? OUTLINE_COLORS[occupancyLevel(occ.free, occ.total)];
        const ws = minimal?.parts.workspaces;
        const latlngs = liftRings(
          outlineToLatLngs(outlineOf(lib)!),
          liftOf(lib.facilityId, lib.floor),
        );
        return (
          <Polygon
            key={lib.id}
            positions={
              minimal ? roundPolygons(latlngs, minimal.cornerRadius) : latlngs
            }
            pathOptions={
              minimal && ws
                ? {
                    ...partPathOptions(minimal, 'workspaces'),
                    color:
                      selected && minimal.highlightCustomColor
                        ? minimal.highlightColor
                        : (mensaColor ??
                          (minimal.occupancyColors ? occColor : ws.color)),
                    fillColor:
                      selected && minimal.highlightCustomColor
                        ? minimal.highlightColor
                        : (mensaColor ??
                          (minimal.occupancyColors ? occColor : ws.fillColor)),
                    fill: true,
                    weight: selected
                      ? ws.weight + minimal.highlightWidth
                      : ws.weight,
                    // Same look on every floor.
                    opacity: ws.opacity,
                    dashArray: undefined,
                    fillOpacity: selected
                      ? Math.min(1, ws.fill + minimal.highlightFill)
                      : ws.fill,
                    interactive: true,
                    bubblingMouseEvents: false,
                  }
                : {
                    // setStyle merges, so reset what the minimal style may have set.
                    fill: true,
                    lineJoin: 'round',
                    lineCap: 'round',
                    color: occColor,
                    fillColor: occColor,
                    weight: selected ? 3.5 : 2.5,
                    opacity: 0.7,
                    dashArray: undefined,
                    fillOpacity: selected ? 0.22 : 0.1,
                    interactive: true,
                    bubblingMouseEvents: false,
                  }
            }
            eventHandlers={{
              click: () => {
                props.onSelect({
                  libraryId: lib.id,
                  tableId: null,
                  seatId: null,
                });
                if (lib.floor !== null) props.onFloorChange(lib.floor);
              },
            }}
          />
        );
      })}

      {/* Pins only for libraries without an outline; the outline itself marks the others. */}
      {data.libraries.map((lib) => {
        if (!shown(lib) || outlineOf(lib)) return null;
        const occ = occupancyOf(data, lib.id);
        return (
          <Marker
            key={lib.id}
            position={[
              lib.position.lat + liftOf(lib.facilityId, lib.floor),
              lib.position.lng,
            ]}
            icon={libraryIcon({
              kind: lib.kind,
              free: occ.free,
              total: occ.total,
              selected: selection.libraryId === lib.id && !selection.tableId,
              approximate: false,
              otherFloor: onFloor(lib)
                ? null
                : libraryFloorLabel(
                    {
                      floor: lib.floor as number,
                      levelId: lib.levelId,
                      facilityId: lib.facilityId,
                    },
                    props.floorIndex?.levels,
                  ),
            })}
            zIndexOffset={
              selection.libraryId === lib.id ? 1000 : onFloor(lib) ? 100 : 0
            }
            eventHandlers={{
              click: () =>
                props.onSelect({
                  libraryId: lib.id,
                  tableId: null,
                  seatId: null,
                }),
            }}
          />
        );
      })}

      {showDetail &&
        tablesOnFloor.map((t) => (
          <Marker
            key={t.id}
            position={[
              t.position.lat + libraryLift(t.libraryId),
              t.position.lng,
            ]}
            icon={tableIcon(
              t.label,
              selection.tableId === t.id && !selection.seatId,
            )}
            zIndexOffset={500}
            eventHandlers={{
              click: () =>
                props.onSelect({
                  libraryId: t.libraryId,
                  tableId: t.id,
                  seatId: null,
                }),
            }}
          />
        ))}

      {showDetail &&
        data.seats
          .filter((s) => tableIdsOnFloor.has(s.tableId))
          .map((s) => {
            const table = data.tables.find((t) => t.id === s.tableId);
            return (
              <Marker
                key={s.id}
                position={[
                  s.position.lat + (table ? libraryLift(table.libraryId) : 0),
                  s.position.lng,
                ]}
                icon={seatIcon(s.status, selection.seatId === s.id)}
                zIndexOffset={800}
                eventHandlers={{
                  click: () =>
                    props.onSelect({
                      libraryId: table?.libraryId ?? null,
                      tableId: s.tableId,
                      seatId: s.id,
                    }),
                }}
              />
            );
          })}

      {props.children}
    </MapContainer>
  );
}

/** Reports the building group the 3D view stacks (see useBuildingGroup). */
function GroupTracker({
  groups,
  onChange,
}: {
  groups: ReadonlyMap<string, BuildingGroup> | null;
  onChange: (group: BuildingGroup | null) => void;
}) {
  const group = useBuildingGroup(groups);
  useEffect(() => onChange(group), [group, onChange]);
  return null;
}

function MapEvents({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
  });
  // The start zoom comes from fitting the bounds, without a zoomend.
  useEffect(() => onZoom(map.getZoom()), [map]);
  return null;
}

/* Fits the start view once the map has its real size. On phones (and in
   background tabs) the map can be created while its container is still
   0×0, which leaves it at the maximum zoom on one spot. */
function FitStart({ bounds }: { bounds: L.LatLngBounds | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      observer.disconnect();
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [16, 16], animate: false });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map, bounds]);
  return null;
}

function FlyTo({ target }: { target: FlyTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    if (target.bounds)
      map.flyToBounds(target.bounds, {
        maxZoom: 20,
        padding: [40, 40],
        duration: 0.8,
      });
    else
      map.flyTo([target.position.lat, target.position.lng], target.zoom, {
        duration: 0.8,
      });
  }, [map, target]);
  return null;
}

/** Fades every base layer (they all live in the tile pane); 0 leaves just the map background. */
function BasemapOpacity({ opacity }: { opacity: number }) {
  const map = useMap();
  useEffect(() => {
    const pane = map.getPane('tilePane');
    if (!pane) return;
    pane.style.opacity = String(opacity);
    pane.style.visibility = opacity <= 0 ? 'hidden' : '';
  }, [map, opacity]);
  return null;
}

/** Attribution for the vector basemaps (they don't use Leaflet's per-layer attribution). */
function AttributionText() {
  const map = useMap();
  useEffect(() => {
    map.attributionControl.addAttribution(OPENFREEMAP_ATTRIBUTION);
    return () =>
      void map.attributionControl.removeAttribution(OPENFREEMAP_ATTRIBUTION);
  }, [map]);
  return null;
}
