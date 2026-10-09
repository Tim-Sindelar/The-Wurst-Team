import { useEffect, useState } from 'react';
import L from 'leaflet';
import { LayersControl, MapContainer, Marker, Polygon, ScaleControl, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng, MultiPolygon, OccupancyData } from '../domain/types';
import { occupancyOf } from '../domain/operations';
import type { Mode, PlacingKind, Selection } from '../state';
import { libraryIcon, occupancyLevel, seatIcon, tableIcon, type OccupancyLevel } from './icons';
import { outlineToLatLngs } from './geo';
import { OutlineEditor } from './OutlineEditor';

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
  data: OccupancyData;
  mode: Mode;
  selection: Selection;
  placing: PlacingKind | null;
  /** Library whose outline is being edited, if any. */
  editingOutlineId: string | null;
  flyTarget: FlyTarget | null;
  onMapClick: (pos: LatLng) => void;
  onSelect: (sel: Selection) => void;
  onMoveLibrary: (id: string, pos: LatLng) => void;
  onMoveTable: (id: string, pos: LatLng) => void;
  onMoveSeat: (id: string, pos: LatLng) => void;
  onZoomChange: (zoom: number) => void;
  onOutlineChange: (libraryId: string, outline: MultiPolygon | null) => void;
}

const toLatLng = (ll: { lat: number; lng: number }): LatLng => ({ lat: ll.lat, lng: ll.lng });

export function MapView(props: Props) {
  const { data, mode, selection, placing, editingOutlineId } = props;
  const editingLibrary = data.libraries.find((l) => l.id === editingOutlineId) ?? null;
  const admin = mode === 'admin';
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const showDetail = zoom >= DETAIL_ZOOM;
  // Computed once: the initial view frames all libraries (both campuses).
  const [initialBounds] = useState(() =>
    L.latLngBounds(data.libraries.map((l) => [l.position.lat, l.position.lng] as [number, number])).pad(0.1),
  );

  return (
    <MapContainer
      bounds={data.libraries.length ? initialBounds : undefined}
      center={[47.3925, 8.528]}
      zoom={INITIAL_ZOOM}
      maxZoom={MAX_ZOOM}
      // Geoman runs in opt-in mode (see geoman.ts); the map itself must opt in.
      pmIgnore={false}
      className={`map${placing ? ' is-placing' : ''}`}
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="OpenStreetMap">
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxNativeZoom={19}
            maxZoom={MAX_ZOOM}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="swisstopo Karte">
          <TileLayer
            url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg"
            attribution='&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>'
            maxNativeZoom={18}
            maxZoom={MAX_ZOOM}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="swisstopo Luftbild">
          <TileLayer
            url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"
            attribution='&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>'
            maxNativeZoom={20}
            maxZoom={MAX_ZOOM}
          />
        </LayersControl.BaseLayer>
      </LayersControl>
      <ScaleControl imperial={false} />

      <MapEvents
        onClick={props.onMapClick}
        onZoom={(z) => {
          setZoom(z);
          props.onZoomChange(z);
        }}
      />
      <FlyTo target={props.flyTarget} />

      {editingLibrary && (
        <OutlineEditor
          key={editingLibrary.id}
          outline={editingLibrary.outline}
          onChange={(outline) => props.onOutlineChange(editingLibrary.id, outline)}
        />
      )}

      {data.libraries.map((lib) => {
        if (!lib.outline || lib.id === editingOutlineId) return null;
        const occ = occupancyOf(data, lib.id);
        const selected = selection.libraryId === lib.id;
        return (
          <Polygon
            key={lib.id}
            positions={outlineToLatLngs(lib.outline)}
            pathOptions={{
              color: OUTLINE_COLORS[occupancyLevel(occ.free, occ.total)],
              weight: selected ? 3 : 2,
              fillOpacity: selected ? 0.2 : 0.1,
            }}
            eventHandlers={{ click: () => props.onSelect({ libraryId: lib.id, tableId: null, seatId: null }) }}
          />
        );
      })}

      {data.libraries.map((lib) => {
        const occ = occupancyOf(data, lib.id);
        return (
          <Marker
            key={lib.id}
            position={[lib.position.lat, lib.position.lng]}
            icon={libraryIcon({
              free: occ.free,
              total: occ.total,
              selected: selection.libraryId === lib.id && !selection.tableId,
              approximate: admin && lib.positionApproximate,
            })}
            draggable={admin}
            zIndexOffset={selection.libraryId === lib.id ? 1000 : 0}
            eventHandlers={{
              click: () => props.onSelect({ libraryId: lib.id, tableId: null, seatId: null }),
              dragend: (e) => props.onMoveLibrary(lib.id, toLatLng(e.target.getLatLng())),
            }}
          >
            <Tooltip direction="top">
              <strong>{lib.name}</strong>
              <br />
              {occ.total === 0 ? 'No seats registered' : `${occ.free} of ${occ.total} seats free`}
            </Tooltip>
          </Marker>
        );
      })}

      {showDetail &&
        data.tables.map((t) => (
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
        data.seats.map((s) => {
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
    </MapContainer>
  );
}

function MapEvents({ onClick, onZoom }: { onClick: (pos: LatLng) => void; onZoom: (zoom: number) => void }) {
  const map = useMapEvents({
    click: (e) => onClick(toLatLng(e.latlng)),
    zoomend: () => onZoom(map.getZoom()),
  });
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
