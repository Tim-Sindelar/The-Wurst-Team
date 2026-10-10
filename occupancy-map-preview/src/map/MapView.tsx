import { useEffect, useMemo, useState, type ReactNode } from 'react';
import L from 'leaflet';
import { LayersControl, MapContainer, Marker, Polygon, ScaleControl, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng, MultiPolygon, OccupancyData, RoomRef } from '../domain/types';
import { occupancyOf } from '../domain/operations';
import type { Mode, PlacingKind, Selection } from '../state';
import { libraryIcon, occupancyLevel, seatIcon, tableIcon, type OccupancyLevel } from './icons';
import { outlineToLatLngs } from './geo';
import { OutlineEditor } from './OutlineEditor';
import { FloorLayer, type MensaRoom, type Theme } from './FloorLayer';
import { VectorBasemap, OPENFREEMAP_ATTRIBUTION } from './VectorBasemap';
import { FloorPicker } from './FloorPicker';
import { libraryFloorLabel, levelName, loadLibraryOutlineRoomKeys, loadLibraryOutlines, outlineFromRooms, roomsKey, type FloorIndex } from '../floors/floorData';
import { partPathOptions, roundPolygons, type MinimalStyle, type OccupancyStyle } from './minimalStyle';
import type { RoomInfo } from '../roomFeatures';
import type { NavigationConfig, NavZone } from '../domain/navigation';
import { NavZones } from './NavZones';

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
  mode: Mode;
  selection: Selection;
  placing: PlacingKind | null;
  /** Library whose outline is being edited, if any. */
  editingOutlineId: string | null;
  flyTarget: FlyTarget | null;
  /** Floor plans; null while loading or when unavailable. */
  floorIndex: FloorIndex | null;
  floor: number;
  onFloorChange: (floor: number) => void;
  onMapClick: (pos: LatLng) => void;
  onSelect: (sel: Selection) => void;
  onMoveLibrary: (id: string, pos: LatLng) => void;
  onMoveTable: (id: string, pos: LatLng) => void;
  onMoveSeat: (id: string, pos: LatLng) => void;
  onZoomChange: (zoom: number) => void;
  onOutlineChange: (libraryId: string, outline: MultiPolygon | null) => void;
  /** Admin room selection mode: clicking rooms toggles them in `pickedRooms`. */
  pickingRooms: boolean;
  pickedRooms: ReadonlySet<string>;
  onPickRoom: (room: RoomRef) => void;
  /** Minimal render mode style; null renders the detailed map. */
  minimal: MinimalStyle | null;
  /** Click-to-zoom zones; null while loading. */
  navigation: NavigationConfig | null;
  /** False while another click action (placing, picking, drawing) is active. */
  navEnabled: boolean;
  /** Admin: the zone being configured, drawn dashed. */
  selectedNavZoneId: string | null;
  /** Admin: zone whose click area is being drawn. */
  editingNavZone: NavZone | null;
  onNavOutlineChange: (zoneId: string, outline: MultiPolygon | null) => void;
  /** The start view (and the home button) frames these: both campuses. */
  homePositions: LatLng[];
  /** Live room mode (see FloorLayer). */
  ethRooms: ReadonlyMap<string, RoomInfo> | null;
  occupancyStyle: OccupancyStyle | null;
  roomLabels: boolean;
  selectedEthRoom: string | null;
  onEthRoomClick: ((ethId: string) => void) | null;
  /** Mensa rooms (see FloorLayer), apart from the workspaces. */
  mensaRooms: ReadonlyMap<string, MensaRoom>;
  selectedMensaId: string | null;
  onSelectMensa: (mensaId: string) => void;
  /** More map layers (the campus datasets), rendered inside the map. */
  children?: ReactNode;
}

const toLatLng = (ll: { lat: number; lng: number }): LatLng => ({ lat: ll.lat, lng: ll.lng });

export function MapView(props: Props) {
  const { data, mode, selection, placing, editingOutlineId, pickingRooms, minimal } = props;
  const labels = !minimal || minimal.basemapLabels;
  const editingLibrary = data.libraries.find((l) => l.id === editingOutlineId) ?? null;
  const admin = mode === 'admin';
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const showDetail = zoom >= DETAIL_ZOOM;
  const { floor } = props;
  /** Libraries without a floor (not in PolyMaps) are shown on every floor. */
  const onFloor = (lib: { floor: number | null }) => lib.floor === null || lib.floor === floor;
  const librariesOnFloor = new Set(data.libraries.filter(onFloor).map((l) => l.id));
  const tablesOnFloor = data.tables.filter((t) => librariesOnFloor.has(t.libraryId));
  const tableIdsOnFloor = new Set(tablesOnFloor.map((t) => t.id));
  const libraryRooms = useMemo(
    () => new Map(data.libraries.flatMap((l) => l.rooms.map((r) => [r, l.id] as const))),
    [data.libraries],
  );
  // Libraries without a hand-drawn outline get one derived from their rooms.
  const [derivedOutlines, setDerivedOutlines] = useState<Record<string, MultiPolygon>>({});
  useEffect(() => void loadLibraryOutlines().then(setDerivedOutlines), []);
  // Workspaces whose rooms differ from what the pipeline built an outline for (created or changed in admin)
  // get theirs from the room polygons, so they look like the pregenerated ones.
  const [baselineKeys, setBaselineKeys] = useState<Record<string, string> | null>(null);
  useEffect(() => void loadLibraryOutlineRoomKeys().then(setBaselineKeys), []);
  const [roomOutlines, setRoomOutlines] = useState<Record<string, { key: string; outline: MultiPolygon | null }>>({});
  const stale = baselineKeys
    ? data.libraries.filter((l) => !l.outline && l.rooms.length && baselineKeys[l.id] !== roomsKey(l.rooms))
    : [];
  const staleKey = stale.map((l) => `${l.id}=${roomsKey(l.rooms)}`).join(';');
  useEffect(() => {
    let cancelled = false;
    for (const l of stale) {
      const key = roomsKey(l.rooms);
      if (roomOutlines[l.id]?.key === key) continue;
      outlineFromRooms(l.rooms).then((outline) => !cancelled && setRoomOutlines((prev) => ({ ...prev, [l.id]: { key, outline } })));
    }
    return () => {
      cancelled = true;
    };
  }, [staleKey]);
  const outlineOf = (lib: { id: string; outline: MultiPolygon | null; rooms?: string[] }) => {
    if (lib.outline) return lib.outline;
    if (baselineKeys && lib.rooms?.length && baselineKeys[lib.id] !== roomsKey(lib.rooms)) {
      const own = roomOutlines[lib.id];
      return own && own.key === roomsKey(lib.rooms) ? own.outline : null;
    }
    return derivedOutlines[lib.id] ?? null;
  };
  // Other floors first, then this floor, the selected library on top.
  const drawOrder = (lib: { id: string; floor: number | null }) => (selection.libraryId === lib.id ? 2 : onFloor(lib) ? 1 : 0);
  const libraryNames = useMemo(() => new Map(data.libraries.map((l) => [l.id, l.name])), [data.libraries]);
  const outlinedLibraries = data.libraries.filter((l) => outlineOf(l)).sort((a, b) => drawOrder(a) - drawOrder(b));

  // Computed once: the initial view frames all workspaces, enabled or not (both campuses).
  // (An empty list has no bounds: fall back to the default center.)
  const [initialBounds] = useState(() =>
    props.homePositions.length
      ? L.latLngBounds(props.homePositions.map((p) => [p.lat, p.lng] as [number, number])).pad(0.1)
      : undefined,
  );

  return (
    <MapContainer
      bounds={initialBounds}
      center={[47.3925, 8.528]}
      zoom={INITIAL_ZOOM}
      maxZoom={MAX_ZOOM}
      // Geoman runs in opt-in mode (see geoman.ts); the map itself must opt in.
      pmIgnore={false}
      className={`map${placing ? ' is-placing' : ''}${pickingRooms ? ' is-picking' : ''}`}
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Clean">
          <VectorBasemap style="positron" labels={labels} />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Streets">
          <VectorBasemap style="bright" labels={labels} />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite">
          <TileLayer
            url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"
            attribution='&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>'
            maxNativeZoom={20}
            maxZoom={MAX_ZOOM}
          />
        </LayersControl.BaseLayer>
      </LayersControl>
      <AttributionText />
      <BasemapOpacity opacity={minimal ? minimal.basemapOpacity : 1} />
      <ScaleControl imperial={false} />

      <MapEvents
        onClick={props.onMapClick}
        onZoom={(z) => {
          setZoom(z);
          props.onZoomChange(z);
        }}
      />
      <FlyTo target={props.flyTarget} />

      {props.floorIndex && (
        <>
          <FloorLayer
            theme={props.theme}
            index={props.floorIndex}
            floor={floor}
            libraryRooms={libraryRooms}
            libraryNames={libraryNames}
            showRoomDetails={admin}
            selectedLibraryId={selection.libraryId}
            onSelectLibrary={(libraryId) => props.onSelect({ libraryId, tableId: null, seatId: null })}
            picking={pickingRooms}
            pickedRooms={props.pickedRooms}
            onPickRoom={props.onPickRoom}
            minimal={minimal}
            ethRooms={props.ethRooms}
            occupancyStyle={props.occupancyStyle}
            roomLabels={props.roomLabels}
            selectedEthRoom={props.selectedEthRoom}
            onEthRoomClick={props.onEthRoomClick}
            mensaRooms={props.mensaRooms}
            selectedMensaId={props.selectedMensaId}
            onSelectMensa={props.onSelectMensa}
          />
          <FloorPicker index={props.floorIndex} floor={floor} libraries={data.libraries} onChange={props.onFloorChange} />
        </>
      )}

      {props.navigation && (
        <NavZones
          config={props.navigation}
          enabled={props.navEnabled}
          highlightedZoneId={props.editingNavZone ? null : props.selectedNavZoneId}
          homeBounds={initialBounds}
          showHints={admin}
        />
      )}

      {props.editingNavZone && (
        <OutlineEditor
          key={`nav-${props.editingNavZone.id}`}
          outline={props.editingNavZone.outline}
          onChange={(outline) => props.onNavOutlineChange(props.editingNavZone!.id, outline)}
        />
      )}

      {editingLibrary && (
        <OutlineEditor
          key={editingLibrary.id}
          outline={editingLibrary.outline}
          onChange={(outline) => props.onOutlineChange(editingLibrary.id, outline)}
        />
      )}

      {outlinedLibraries.map((lib) => {
        // Outlines sit above the room canvas, so they are hidden while picking rooms.
        if (lib.id === editingOutlineId || pickingRooms || (minimal && !minimal.parts.workspaces.show)) return null;
        const occ = occupancyOf(data, lib.id);
        const selected = selection.libraryId === lib.id;
        const occColor = OUTLINE_COLORS[occupancyLevel(occ.free, occ.total)];
        const ws = minimal?.parts.workspaces;
        return (
          <Polygon
            key={lib.id}
            positions={minimal ? roundPolygons(outlineToLatLngs(outlineOf(lib)!), minimal.cornerRadius) : outlineToLatLngs(outlineOf(lib)!)}
            pathOptions={
              minimal && ws
                ? {
                    ...partPathOptions(minimal, 'workspaces'),
                    color: selected && minimal.highlightCustomColor ? minimal.highlightColor : minimal.occupancyColors ? occColor : ws.color,
                    fillColor: selected && minimal.highlightCustomColor ? minimal.highlightColor : minimal.occupancyColors ? occColor : ws.fillColor,
                    fill: true,
                    weight: selected ? ws.weight + minimal.highlightWidth : ws.weight,
                    // Same look on every floor.
                    opacity: ws.opacity,
                    dashArray: undefined,
                    fillOpacity: selected ? Math.min(1, ws.fill + minimal.highlightFill) : ws.fill,
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
            eventHandlers={{ click: () => {
                props.onSelect({ libraryId: lib.id, tableId: null, seatId: null });
                if (lib.floor !== null) props.onFloorChange(lib.floor);
              } }}
          >
            <Tooltip sticky>
              <strong>{lib.name}</strong>
              <br />
              {occ.total === 0 ? 'No seats registered' : `${occ.free} of ${occ.total} seats free`}
              {lib.floor !== null && (
                <>
                  <br />
                  <span className="muted">Floor {libraryFloorLabel({ floor: lib.floor, levelId: lib.levelId }, props.floorIndex?.levels)}{lib.levelId ? ` · ${levelName(lib.levelId)}` : ''}</span>
                </>
              )}
            </Tooltip>
          </Polygon>
        );
      })}

      {/* Pins only for libraries without an outline; the outline itself marks the others. */}
      {data.libraries.map((lib) => {
        if (outlineOf(lib)) return null;
        const occ = occupancyOf(data, lib.id);
        return (
          <Marker
            key={lib.id}
            position={[lib.position.lat, lib.position.lng]}
            icon={libraryIcon({
              kind: lib.kind,
              free: occ.free,
              total: occ.total,
              selected: selection.libraryId === lib.id && !selection.tableId,
              approximate: admin && lib.positionApproximate,
              otherFloor: onFloor(lib) ? null : libraryFloorLabel({ floor: lib.floor as number, levelId: lib.levelId }, props.floorIndex?.levels),
            })}
            draggable={admin}
            zIndexOffset={selection.libraryId === lib.id ? 1000 : onFloor(lib) ? 100 : 0}
            eventHandlers={{
              click: () => props.onSelect({ libraryId: lib.id, tableId: null, seatId: null }),
              dragend: (e) => props.onMoveLibrary(lib.id, toLatLng(e.target.getLatLng())),
            }}
          >
            <Tooltip direction="top">
              <strong>{lib.name}</strong>
              <br />
              {occ.total === 0 ? 'No seats registered' : `${occ.free} of ${occ.total} seats free`}
              {lib.floor !== null && (
                <>
                  <br />
                  <span className="muted">Floor {libraryFloorLabel({ floor: lib.floor, levelId: lib.levelId }, props.floorIndex?.levels)}{lib.levelId ? ` · ${levelName(lib.levelId)}` : ''}</span>
                </>
              )}
            </Tooltip>
          </Marker>
        );
      })}

      {showDetail &&
        tablesOnFloor.map((t) => (
          <Marker
            key={t.id}
            position={[t.position.lat, t.position.lng]}
            icon={tableIcon(t.label, selection.tableId === t.id && !selection.seatId)}
            draggable={admin}
            zIndexOffset={500}
            eventHandlers={{
              click: () => props.onSelect({ libraryId: t.libraryId, tableId: t.id, seatId: null }),
              dragend: (e) => props.onMoveTable(t.id, toLatLng(e.target.getLatLng())),
            }}
          />
        ))}

      {showDetail &&
        data.seats.filter((s) => tableIdsOnFloor.has(s.tableId)).map((s) => {
          const table = data.tables.find((t) => t.id === s.tableId);
          return (
            <Marker
              key={s.id}
              position={[s.position.lat, s.position.lng]}
              icon={seatIcon(s.status, selection.seatId === s.id)}
              draggable={admin}
              zIndexOffset={800}
              eventHandlers={{
                click: () =>
                  props.onSelect({ libraryId: table?.libraryId ?? null, tableId: s.tableId, seatId: s.id }),
                dragend: (e) => props.onMoveSeat(s.id, toLatLng(e.target.getLatLng())),
              }}
            >
              <Tooltip direction="top">
                {s.label}: {s.status}
              </Tooltip>
            </Marker>
          );
        })}

      {props.children}
    </MapContainer>
  );
}

function MapEvents({ onClick, onZoom }: { onClick: (pos: LatLng) => void; onZoom: (zoom: number) => void }) {
  const map = useMapEvents({
    click: (e) => onClick(toLatLng(e.latlng)),
    zoomend: () => onZoom(map.getZoom()),
  });
  // The start zoom comes from fitting the bounds, without a zoomend.
  useEffect(() => onZoom(map.getZoom()), [map]);
  return null;
}

function FlyTo({ target }: { target: FlyTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    if (target.bounds) map.flyToBounds(target.bounds, { maxZoom: 20, padding: [40, 40], duration: 0.8 });
    else map.flyTo([target.position.lat, target.position.lng], target.zoom, { duration: 0.8 });
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
    return () => void map.attributionControl.removeAttribution(OPENFREEMAP_ATTRIBUTION);
  }, [map]);
  return null;
}
