import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import polygonClipping from 'polygon-clipping';
import { useMap, useMapEvents } from 'react-leaflet';
import { intersects, loadLevel, type FloorIndex, type LevelPlan, type LineLayer, type Room, type RoomKind } from '../floors/floorData';
import type { RoomRef } from '../domain/types';
import { outlineToLatLngs } from './geo';
import { partPathOptions, roundLines, roundPolygons, type MinimalStyle, type PartKey } from './minimalStyle';

/** Rooms are drawn from this zoom level on, walls and doors from LINE_ZOOM. */
export const ROOM_ZOOM = 18;
const LINE_ZOOM = 19;
const OUTLINE_ZOOM = 15;

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

const LINE_STYLE: Record<Theme, Record<LineLayer, L.PolylineOptions>> = {
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

const BUILDING_STYLE: Record<Theme, { color: string; fillColor: string; fillOpacity: number; levelColor: string; levelFill: string }> = {
  light: { color: '#b9c0cb', fillColor: '#dfe3ea', fillOpacity: 0.5, levelColor: '#5a6372', levelFill: '#fbfbfc' },
  dark: { color: '#3d4553', fillColor: '#2a303b', fillOpacity: 0.6, levelColor: '#8792a5', levelFill: '#1e232c' },
};

const LINE_PART: Record<LineLayer, PartKey> = { wall: 'walls', door: 'doors', stair: 'stairs' };

const PANES = { buildings: ['floor-buildings', 340], rooms: ['floor-rooms', 350], lines: ['floor-lines', 360] } as const;

interface Props {
  theme: Theme;
  index: FloorIndex;
  floor: number;
  /** PolyMaps room id → library id, for highlighting and selecting library rooms. */
  libraryRooms: Map<string, string>;
  /** Library id → name, for the room tooltip of the normal map. */
  libraryNames: ReadonlyMap<string, string>;
  /** Admin mode: tooltips show every room's details instead of the workspace name. */
  showRoomDetails: boolean;
  selectedLibraryId: string | null;
  onSelectLibrary: (libraryId: string) => void;
  /** Room selection mode (admin): clicking any room toggles it instead of selecting its workspace. */
  picking: boolean;
  pickedRooms: ReadonlySet<string>;
  onPickRoom: (room: RoomRef) => void;
  /** Minimal render mode style; null draws the detailed plan. */
  minimal: MinimalStyle | null;
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
export function FloorLayer({ theme, index, floor, libraryRooms, libraryNames, showRoomDetails, selectedLibraryId, onSelectLibrary, picking, pickedRooms, onPickRoom, minimal }: Props) {
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

  const radius = minimal?.cornerRadius ?? 0;

  // Footprints of all buildings, always visible as context.
  useEffect(() => {
    if (minimal && !minimal.parts.buildings.show) return;
    const style = minimal
      ? partPathOptions(minimal, 'buildings')
      : { color: BUILDING_STYLE[theme].color, weight: 1, fillColor: BUILDING_STYLE[theme].fillColor, fillOpacity: BUILDING_STYLE[theme].fillOpacity };
    const group = L.layerGroup(
      index.facilities.map((f) =>
        L.polygon(roundPolygons(outlineToLatLngs(f.outline), radius), { renderer: renderers.buildings, interactive: false, ...style }),
      ),
    ).addTo(map);
    return () => void group.remove();
  }, [map, index, renderers, theme, minimal, radius]);

  const floorLevels = useMemo(() => index.levels.filter((l) => l.floor === floor), [index, floor]);

  // Outlines of the levels on the selected floor.
  useEffect(() => {
    if (view.zoom < OUTLINE_ZOOM || (minimal && !minimal.parts.levels.show)) return;
    const style = minimal
      ? partPathOptions(minimal, 'levels')
      : { color: BUILDING_STYLE[theme].levelColor, weight: 1.5, fillColor: BUILDING_STYLE[theme].levelFill, fillOpacity: 0.9 };
    const group = L.layerGroup(
      floorLevels.map((l) =>
        L.polygon(roundPolygons(outlineToLatLngs(l.outline), radius), { renderer: renderers.buildings, interactive: false, ...style }),
      ),
    ).addTo(map);
    return () => void group.remove();
  }, [map, floorLevels, renderers, theme, view.zoom >= OUTLINE_ZOOM, minimal, radius]);

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
  const fillLayers = useRef(new Map<string, L.Polygon>());
  useEffect(() => {
    const roomGroup = L.layerGroup().addTo(map);
    roomLayers.current = new Map();
    const libraryRings = new Map<string, [number, number][][][]>();
    for (const id of visibleIds) {
      const plan = plans.get(id);
      const level = levelsById.get(id);
      if (!plan || !level) continue;
      for (const room of plan.rooms) {
        const libraryId = libraryRooms.get(room.id) ?? null;
        const poly = L.polygon(roundPolygons(room.rings, radius), {
          renderer: renderers.rooms,
          ...roomLayerStyle(theme, room.kind, libraryId, selectedLibraryId, pickedRooms.has(room.id), minimal, picking),
        });
        // Normal map: only rooms of an enabled workspace get a tooltip, showing the workspace name.
        // Admin mode keeps the room details, they are needed to pick rooms.
        const title = room.label && room.label !== room.name ? `${room.label} · ${room.name}` : room.name;
        const tip = showRoomDetails
          ? `<strong>${escapeHtml(title)}</strong><br>${escapeHtml(room.use || 'Raum')}${room.area ? ` · ${room.area} m²` : ''}`
          : libraryId && libraryNames.get(libraryId)
            ? `<strong>${escapeHtml(libraryNames.get(libraryId)!)}</strong>`
            : null;
        if (tip) poly.bindTooltip(tip, { sticky: true, direction: 'top', offset: [0, -6] });
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
              address: [index.facilities.find((x) => x.id === level.facilityId)?.address, room.name].filter(Boolean).join(', ') || null,
            });
          } else if (libraryId) {
            h.onSelectLibrary(libraryId);
          }
        });
        roomLayers.current.set(room.id, { poly, kind: room.kind, libraryId });
        roomGroup.addLayer(poly);
        if (libraryId) (libraryRings.get(libraryId) ?? libraryRings.set(libraryId, []).get(libraryId)!).push(...room.rings);
      }
    }
    // A workspace's rooms are filled as one merged shape, so overlapping rooms don't add up their alpha.
    fillLayers.current = new Map();
    for (const [libraryId, polys] of libraryRings) {
      let merged: [number, number][][][];
      try {
        const [first, ...rest] = polys.map((rings) => rings.map((r) => r.map(([lat, lng]) => [lng, lat] as [number, number])));
        merged = polygonClipping.union(first as polygonClipping.Geom, ...(rest as polygonClipping.Geom[])).map((poly) =>
          poly.map((ring) => ring.slice(0, -1).map(([lng, lat]) => [lat, lng] as [number, number])),
        );
      } catch {
        merged = polys;
      }
      const fill = L.polygon(roundPolygons(merged, radius), {
        renderer: renderers.rooms,
        interactive: false,
        ...roomStyle(theme, 'library', libraryId, selectedLibraryId, false, minimal, picking),
      });
      fillLayers.current.set(libraryId, fill);
      roomGroup.addLayer(fill);
    }
    return () => void roomGroup.remove();
    // Selection changes are applied by restyling below instead of rebuilding.
  }, [map, renderers, plans, visibleKey, libraryRooms, libraryNames, showRoomDetails, levelsById, theme, radius]);

  useEffect(() => {
    for (const [roomId, { poly, kind, libraryId }] of roomLayers.current) {
      poly.setStyle(roomLayerStyle(theme, kind, libraryId, selectedLibraryId, pickedRooms.has(roomId), minimal, picking));
    }
    for (const [libraryId, fill] of fillLayers.current) {
      fill.setStyle(roomStyle(theme, 'library', libraryId, selectedLibraryId, false, minimal, picking));
    }
  }, [selectedLibraryId, pickedRooms, plans, visibleKey, libraryRooms, theme, minimal, picking, radius]);

  const showLines = view.zoom >= LINE_ZOOM;
  useEffect(() => {
    if (!showLines) return;
    const group = L.layerGroup().addTo(map);
    for (const id of visibleIds) {
      const plan = plans.get(id);
      if (!plan) continue;
      for (const [layer, lines] of Object.entries(plan.lines) as [LineLayer, [number, number][][]][]) {
        if (!lines.length || (minimal && !minimal.parts[LINE_PART[layer]].show)) continue;
        const style = minimal ? partPathOptions(minimal, LINE_PART[layer]) : LINE_STYLE[theme][layer];
        group.addLayer(L.polyline(roundLines(lines, radius), { ...style, renderer: renderers.lines, interactive: false }));
      }
    }
    return () => void group.remove();
  }, [map, renderers, plans, visibleKey, showLines, theme, minimal, radius]);

  return null;
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
  const style = roomStyle(theme, kind, libraryId, selectedLibraryId, picked, minimal, picking);
  return libraryId && !picked ? { ...style, fillOpacity: 0 } : style;
}

/** Resets what a minimal style may have changed when restyling back to the detailed plan. */
const DETAILED_PATH: L.PolylineOptions = { stroke: true, fill: true, opacity: 1, lineJoin: 'round', lineCap: 'round', smoothFactor: 1 };

function roomStyle(
  theme: Theme,
  kind: RoomKind,
  libraryId: string | null,
  selectedLibraryId: string | null,
  picked: boolean,
  minimal: MinimalStyle | null,
  picking: boolean,
): L.PolylineOptions {
  if (picked) return { ...DETAILED_PATH, color: '#b85a00', weight: 2.5, fillColor: '#f08a24', fillOpacity: 0.6 };
  if (minimal) {
    const lib = minimal.parts.libraryRooms;
    if (libraryId && lib.show) {
      const style = partPathOptions(minimal, 'libraryRooms');
      // No per-room border: the workspace outline marks the edge of the whole.
      if (libraryId !== selectedLibraryId) return { ...style, stroke: false };
      return { ...style, stroke: false, fill: true, fillOpacity: Math.min(1, lib.fill + 0.25) };
    }
    if (!libraryId && minimal.parts.rooms.show && minimal.roomKinds.includes(kind)) return partPathOptions(minimal, 'rooms');
    // Hidden rooms stay on the canvas, invisible, so tooltips, clicks and picking keep working;
    // while picking they get a faint outline so there is something to click.
    return picking
      ? { ...partPathOptions(minimal, 'rooms'), stroke: true, weight: 0.6, opacity: 0.6, fill: true, fillOpacity: 0 }
      : { stroke: false, fill: true, fillOpacity: 0 };
  }
  if (libraryId) {
    const selected = libraryId === selectedLibraryId;
    const c = theme === 'dark' ? '#4c8dff' : '#215caf';
    return { ...DETAILED_PATH, stroke: false, fillColor: c, fillOpacity: selected ? 0.5 : 0.3 };
  }
  return { ...DETAILED_PATH, color: theme === 'dark' ? '#3d4553' : '#c3cad4', weight: 0.6, fillColor: ROOM_FILL[theme][kind], fillOpacity: 0.85 };
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
