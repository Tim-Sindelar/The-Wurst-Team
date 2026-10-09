import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { useMap, useMapEvents } from 'react-leaflet';
import { intersects, loadLevel, type FloorIndex, type LevelPlan, type LineLayer, type Room, type RoomKind } from '../floors/floorData';
import type { RoomRef } from '../domain/types';
import { outlineToLatLngs } from './geo';

/** Rooms are drawn from this zoom level on, walls and doors from LINE_ZOOM. */
export const ROOM_ZOOM = 18;
const LINE_ZOOM = 19;
const OUTLINE_ZOOM = 15;

const ROOM_FILL: Record<RoomKind, string> = {
  library: '#215caf',
  teaching: '#f3e2b3',
  study: '#d5ebcb',
  office: '#eceff3',
  lab: '#e4dbf0',
  circulation: '#ffffff',
  stairs: '#d0d5dc',
  sanitary: '#d3e8f2',
  food: '#f6d6c4',
  outdoor: '#e0edd6',
  service: '#e6e6e6',
  other: '#f1f1f1',
};

const LINE_STYLE: Record<LineLayer, L.PolylineOptions> = {
  wall: { color: '#3c4450', weight: 1.2, opacity: 0.9 },
  door: { color: '#8a94a3', weight: 0.8, opacity: 0.9 },
  stair: { color: '#9aa3ae', weight: 0.6, opacity: 0.9 },
};

const PANES = { buildings: ['floor-buildings', 340], rooms: ['floor-rooms', 350], lines: ['floor-lines', 360] } as const;

interface Props {
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
}

interface RoomLayer {
  poly: L.Polygon;
  kind: RoomKind;
  libraryId: string | null;
}

/**
 * Draws the ETH floor plans for one floor: every building's footprint, the
 * outline of the levels on that floor and, when zoomed in, rooms (colored by
 * use, library rooms highlighted) plus walls, doors and stairs. Level files
 * are loaded lazily for the levels in view.
 */
export function FloorLayer({ index, floor, libraryRooms, selectedLibraryId, onSelectLibrary, picking, pickedRooms, onPickRoom }: Props) {
  const map = useMap();
  const [view, setView] = useState(() => ({ bounds: map.getBounds(), zoom: map.getZoom() }));
  useMapEvents({ moveend: () => setView({ bounds: map.getBounds(), zoom: map.getZoom() }) });

  const renderers = useMemo(() => {
    const make = ([name, z]: readonly [string, number], interactive = false) => {
      if (!map.getPane(name)) {
        const pane = map.createPane(name);
        pane.style.zIndex = String(z);
        // A canvas covers the whole map, so non-interactive ones must let events through to the rooms below.
        if (!interactive) pane.style.pointerEvents = 'none';
      }
      return L.canvas({ pane: name, padding: 0.3 });
    };
    return { buildings: make(PANES.buildings), rooms: make(PANES.rooms, true), lines: make(PANES.lines) };
  }, [map]);

  // Footprints of all buildings, always visible as context.
  useEffect(() => {
    const group = L.layerGroup(
      index.facilities.map((f) =>
        L.polygon(outlineToLatLngs(f.outline), {
          renderer: renderers.buildings,
          interactive: false,
          color: '#a3abb6',
          weight: 1,
          fillColor: '#c9ced6',
          fillOpacity: 0.35,
        }),
      ),
    ).addTo(map);
    return () => void group.remove();
  }, [map, index, renderers]);

  const floorLevels = useMemo(() => index.levels.filter((l) => l.floor === floor), [index, floor]);

  // Outlines of the levels on the selected floor.
  useEffect(() => {
    if (view.zoom < OUTLINE_ZOOM) return;
    const group = L.layerGroup(
      floorLevels.map((l) =>
        L.polygon(outlineToLatLngs(l.outline), {
          renderer: renderers.buildings,
          interactive: false,
          color: '#4a5361',
          weight: 1.5,
          fillColor: '#fbfbfc',
          fillOpacity: 0.9,
        }),
      ),
    ).addTo(map);
    return () => void group.remove();
  }, [map, floorLevels, renderers, view.zoom >= OUTLINE_ZOOM]);

  // Rooms and lines of the levels in view, loaded on demand.
  const visibleIds = useMemo(() => {
    if (view.zoom < ROOM_ZOOM) return [];
    const b = view.bounds.pad(0.2);
    const box = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    return floorLevels.filter((l) => intersects(l.bbox, box)).map((l) => l.id);
  }, [floorLevels, view]);
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

  // Callbacks change every render; the layers read them through a ref.
  const handlers = useRef({ onSelectLibrary, onPickRoom, picking });
  handlers.current = { onSelectLibrary, onPickRoom, picking };
  const levelsById = useMemo(() => new Map(index.levels.map((l) => [l.id, l])), [index]);

  const roomLayers = useRef(new Map<string, RoomLayer>());
  useEffect(() => {
    const roomGroup = L.layerGroup().addTo(map);
    roomLayers.current = new Map();
    for (const id of visibleIds) {
      const plan = plans.get(id);
      const level = levelsById.get(id);
      if (!plan || !level) continue;
      for (const room of plan.rooms) {
        const libraryId = libraryRooms.get(room.id) ?? null;
        const poly = L.polygon(room.rings, {
          renderer: renderers.rooms,
          ...roomStyle(room.kind, libraryId, selectedLibraryId, pickedRooms.has(room.id)),
        });
        const title = room.label && room.label !== room.name ? `${room.label} · ${room.name}` : room.name;
        poly.bindTooltip(`<strong>${escapeHtml(title)}</strong><br>${escapeHtml(room.use || 'Raum')}${room.area ? ` · ${room.area} m²` : ''}`, {
          sticky: true,
          direction: 'top',
          offset: [0, -6],
        });
        poly.on('click', (e) => {
          const h = handlers.current;
          if (h.picking) {
            L.DomEvent.stop(e);
            h.onPickRoom({
              id: room.id,
              name: room.name,
              levelId: level.id,
              facilityId: level.facilityId,
              floor: level.floor,
              area: room.area,
              center: roomCenter(room),
            });
          } else if (libraryId) {
            h.onSelectLibrary(libraryId);
          }
        });
        roomLayers.current.set(room.id, { poly, kind: room.kind, libraryId });
        roomGroup.addLayer(poly);
      }
    }
    return () => void roomGroup.remove();
    // Selection changes are applied by restyling below instead of rebuilding.
  }, [map, renderers, plans, visibleKey, libraryRooms, levelsById]);

  useEffect(() => {
    for (const [roomId, { poly, kind, libraryId }] of roomLayers.current) {
      poly.setStyle(roomStyle(kind, libraryId, selectedLibraryId, pickedRooms.has(roomId)));
    }
  }, [selectedLibraryId, pickedRooms, plans, visibleKey, libraryRooms]);

  const showLines = view.zoom >= LINE_ZOOM;
  useEffect(() => {
    if (!showLines) return;
    const group = L.layerGroup().addTo(map);
    for (const id of visibleIds) {
      const plan = plans.get(id);
      if (!plan) continue;
      for (const [layer, lines] of Object.entries(plan.lines) as [LineLayer, [number, number][][]][]) {
        if (lines.length) group.addLayer(L.polyline(lines, { ...LINE_STYLE[layer], renderer: renderers.lines, interactive: false }));
      }
    }
    return () => void group.remove();
  }, [map, renderers, plans, visibleKey, showLines]);

  return null;
}

function roomStyle(kind: RoomKind, libraryId: string | null, selectedLibraryId: string | null, picked: boolean): L.PathOptions {
  if (picked) return { color: '#b85a00', weight: 2.5, fillColor: '#f08a24', fillOpacity: 0.6 };
  if (libraryId) {
    const selected = libraryId === selectedLibraryId;
    return { color: '#215caf', weight: selected ? 2.5 : 1.2, fillColor: '#215caf', fillOpacity: selected ? 0.5 : 0.3 };
  }
  return { color: '#b4bcc7', weight: 0.6, fillColor: ROOM_FILL[kind], fillOpacity: 0.85 };
}

/** Area-weighted centroid of the room's largest polygon (outer ring), as a map position. */
function roomCenter(room: Room): RoomRef['center'] {
  let best = { area: -1, lat: 0, lng: 0 };
  for (const [outer] of room.rings) {
    let a = 0, cx = 0, cy = 0;
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
      best = area > 1e-14
        ? { area, lat: cy / (3 * a), lng: cx / (3 * a) }
        : { area, lat: outer.reduce((s, p) => s + p[0], 0) / outer.length, lng: outer.reduce((s, p) => s + p[1], 0) / outer.length };
    }
  }
  return { lat: +best.lat.toFixed(7), lng: +best.lng.toFixed(7) };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
