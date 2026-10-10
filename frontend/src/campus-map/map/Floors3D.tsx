import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { useMap, useMapEvents } from 'react-leaflet';
import {
  intersects,
  levelName,
  loadLevel,
  type FloorIndex,
  type LevelInfo,
  type LevelPlan,
  type LineLayer,
} from '../floors/floorData';
import { outlineToLatLngs } from './geo';
import {
  dropSmallLines,
  mergeParallelEdges,
  metersPerPixel,
  partPathOptions,
  polygonsSmallerThan,
  roundLines,
  roundPolygons,
  type MinimalStyle,
  type OccupancyStyle,
  type View3DStyle,
} from './minimalStyle';
import {
  asMensaRoom,
  BUILDING_STYLE,
  LINE_PART,
  LINE_STYLE,
  LINE_ZOOM,
  mensaStyle,
  occupancyPath,
  ROOM_ZOOM,
  roomStyle,
  type MensaRoom,
  type Theme,
} from './FloorLayer';
import type { RoomInfo } from '../roomFeatures';
import {
  addRing,
  BASE_ZOOM,
  drawBatch,
  paintKey,
  paintOf,
  projectRing,
  projectX,
  projectY,
  sceneCanvas,
  windPolygon,
  type Batch,
  type Flat,
  type SceneView,
} from './sceneCanvas';

// Pseudo-3D view: the other floors of every building in view are drawn with
// the same styles as the selected floor and moved north by `spacing` meters
// per floor. Each floor is drawn on a scratch canvas and faded as a whole (so
// overlapping shapes don't add up their alpha). The selected floor stays where
// it is, drawn by FloorLayer, so it keeps its clicks, markers and outlines;
// floors below sit under it, floors above lie over it. An outline around each
// building's whole stack (its footprint swept from the lowest to the highest
// floor shown) ties the floors together.
//
// Speed: nothing here is a Leaflet path. Geometry is projected once per level
// and kept; paths of one paint are merged into one Path2D, rebuilt only when
// the styles change; panning and zooming just redraw those through a canvas
// transform (see sceneCanvas.ts).
//
// The part of another floor that sticks out from under the selected one (the
// front of the floors below, the back of the floors above) is a click target:
// clicking it switches to that floor. Click-to-zoom zones and everything else
// clickable (rooms, pins, workspace outlines, dataset items) come first.

/** Below this zoom a storey is only a few pixels high: nothing is stacked. */
const MIN_ZOOM = 16;
const LABEL_ZOOM = 18;
const M_PER_DEG_LAT = 110_574;

const SHELL_PANE = ['floor-3d-shell', 338] as const;
const BELOW_PANE = ['floor-3d-below', 345] as const;
const ABOVE_PANE = ['floor-3d-above', 365] as const;

interface Props {
  theme: Theme;
  index: FloorIndex;
  floor: number;
  onFloorChange: (floor: number) => void;
  style: View3DStyle;
  /** The plans are drawn as the selected floor is (see FloorLayer). */
  minimal: MinimalStyle | null;
  libraryRooms: Map<string, string>;
  selectedLibraryId: string | null;
  ethRooms: ReadonlyMap<string, RoomInfo> | null;
  occupancyStyle: OccupancyStyle | null;
  mensaRooms: ReadonlyMap<string, MensaRoom>;
  selectedMensaId: string | null;
}

/** What room and line paints depend on; a new object means the cached batches are stale. */
interface Paint {
  theme: Theme;
  minimal: MinimalStyle | null;
  libraryRooms: Map<string, string>;
  selectedLibraryId: string | null;
  ethRooms: ReadonlyMap<string, RoomInfo> | null;
  occupancyStyle: OccupancyStyle | null;
  mensaRooms: ReadonlyMap<string, MensaRoom>;
  selectedMensaId: string | null;
}

interface Scene {
  floor: number;
  style: View3DStyle;
  paint: Paint;
  /** Levels of the other floors drawn. */
  levels: LevelInfo[];
  /** Levels of the selected floor: clicks on them are left to the plan. */
  current: LevelInfo[];
  plans: ReadonlyMap<string, LevelPlan>;
  buildings: Building[];
}

/** Projected shape: origin and bounds in BASE_ZOOM pixels, geometry relative to the origin. */
interface Placed {
  ox: number;
  oy: number;
  /** Absolute bounds [x0, y0, x1, y1] (y grows southward). */
  box: [number, number, number, number];
  lat: number;
}

interface Building extends Placed {
  id: string;
  /** Outer rings, relative to the origin. */
  rings: Flat[];
  roof: Path2D;
  floors: number[];
  labels: Map<number, string>;
}

interface LevelDrawable {
  paint: Paint;
  plan: LevelPlan | undefined;
  outline: Batch | null;
  rooms: Batch[] | null;
  lines: Batch[] | null;
}

export function Floors3D({
  theme,
  index,
  floor,
  onFloorChange,
  style,
  minimal,
  libraryRooms,
  selectedLibraryId,
  ethRooms,
  occupancyStyle,
  mensaRooms,
  selectedMensaId,
}: Props) {
  const map = useMap();
  const [view, setView] = useState(() => ({
    bounds: map.getBounds(),
    zoom: map.getZoom(),
  }));
  useMapEvents({
    moveend: () => setView({ bounds: map.getBounds(), zoom: map.getZoom() }),
  });

  // Levels of the floors shown, apart from the selected one.
  const levels = useMemo(
    () =>
      index.levels
        .filter(
          (l) =>
            l.floor !== floor &&
            Math.abs(l.floor - floor) <= style.range &&
            (style.showAbove || l.floor < floor),
        )
        .sort((a, b) => a.floor - b.floor),
    [index, floor, style.range, style.showAbove],
  );

  const box = useMemo(() => {
    const b = view.bounds.pad(0.2);
    return {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
  }, [view]);

  // Plans of the levels in view (after their move north or south), loaded on demand.
  const loadIds =
    view.zoom >= ROOM_ZOOM
      ? levels
          .filter((l) => {
            const d = ((l.floor - floor) * style.spacing) / M_PER_DEG_LAT;
            return intersects(
              [l.bbox[0], l.bbox[1] + d, l.bbox[2], l.bbox[3] + d],
              box,
            );
          })
          .map((l) => l.id)
      : [];
  const loadKey = loadIds.join('|');
  const [plans, setPlans] = useState<ReadonlyMap<string, LevelPlan>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const missing = loadIds.filter((id) => !plans.has(id));
    // One state update for the whole batch, not one rebuild per file.
    Promise.all(
      missing.map((id) =>
        loadLevel(id).catch(
          (err) => void console.warn(`Floor plan ${id} failed to load`, err),
        ),
      ),
    ).then((loaded) => {
      if (cancelled || !loaded.some(Boolean)) return;
      setPlans((prev) => {
        const next = new Map(prev);
        for (const p of loaded) if (p) next.set(p.id, p);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [loadKey]);

  const current = useMemo(
    () => index.levels.filter((l) => l.floor === floor),
    [index, floor],
  );
  const buildings = useMemo(() => buildBuildings(index), [index]);

  // A slider of the 3D section must not count as a change of the plan styles.
  const minimalKey = minimal
    ? JSON.stringify({ ...minimal, view3d: null })
    : '';
  const paint = useMemo<Paint>(
    () => ({
      theme,
      minimal,
      libraryRooms,
      selectedLibraryId,
      ethRooms,
      occupancyStyle,
      mensaRooms,
      selectedMensaId,
    }),
    [
      theme,
      minimalKey,
      libraryRooms,
      selectedLibraryId,
      ethRooms,
      occupancyStyle,
      mensaRooms,
      selectedMensaId,
    ],
  );

  const scene = useRef<Scene | null>(null);
  /** Floor under the pointer that a click would switch to. */
  const hovered = useRef<number | null>(null);
  const drawables = useRef(new Map<string, LevelDrawable>());

  const layers = useMemo(() => {
    const below = sceneCanvas(BELOW_PANE[0], (ctx, v) =>
      drawFloors(ctx, v, 'below'),
    );
    const above = sceneCanvas(ABOVE_PANE[0], (ctx, v) =>
      drawFloors(ctx, v, 'above'),
    );
    const shell = sceneCanvas(SHELL_PANE[0], drawShell);
    return [shell, below, above];

    function drawFloors(
      ctx: CanvasRenderingContext2D,
      v: SceneView,
      side: 'below' | 'above',
    ) {
      const sc = scene.current;
      if (!sc || v.zoom < MIN_ZOOM) return;
      const byFloor = new Map<
        number,
        { level: LevelInfo; placed: Placed; dy: number }[]
      >();
      for (const level of sc.levels) {
        if (side === 'below' ? level.floor > sc.floor : level.floor < sc.floor)
          continue;
        const placed = placeLevel(level);
        const dy = floorShift(sc, level.floor, placed.lat, v.zoom);
        if (!onCanvas(placed.box, dy, v)) continue;
        (
          byFloor.get(level.floor) ??
          byFloor.set(level.floor, []).get(level.floor)!
        ).push({ level, placed, dy });
      }
      const r = v.ratio;
      const s = v.scale;
      const rooms = v.zoom >= ROOM_ZOOM;
      const lines = rooms && v.zoom >= LINE_ZOOM && sc.style.ghostLines;
      for (const f of [...byFloor.keys()].sort((a, b) => a - b)) {
        const off = v.scratch();
        for (const { level, placed, dy } of byFloor.get(f)!) {
          const d = drawableOf(sc, level, rooms, lines);
          off.setTransform(
            r * s,
            0,
            0,
            r * s,
            r * (placed.ox * s + v.offsetX),
            r * (placed.oy * s + v.offsetY - dy),
          );
          if (d.outline) drawBatch(off, d.outline, s);
          if (rooms) for (const b of d.rooms ?? []) drawBatch(off, b, s);
          if (lines) for (const b of d.lines ?? []) drawBatch(off, b, s);
        }
        const alpha =
          sc.style.ghostOpacity *
          sc.style.falloff ** (Math.abs(f - sc.floor) - 1);
        ctx.globalAlpha =
          f === hovered.current
            ? Math.max(0.45, Math.min(1, alpha * 3))
            : alpha;
        ctx.drawImage(off.canvas, 0, 0);
      }
      if (side === 'above') drawTop(ctx, v, sc);
    }

    /** Roof edges and floor letters, over the whole stack. */
    function drawTop(ctx: CanvasRenderingContext2D, v: SceneView, sc: Scene) {
      const st = sc.style;
      const labels = st.floorLabels && v.zoom >= LABEL_ZOOM;
      if (!(st.shell && st.roof) && !labels) return;
      const r = v.ratio;
      const s = v.scale;
      const css = labels ? getComputedStyle(document.documentElement) : null;
      for (const b of sc.buildings) {
        const range = stackOf(sc, b);
        if (!range) continue;
        const lo = floorShift(sc, range.lo, b.lat, v.zoom);
        const hi = floorShift(sc, range.hi, b.lat, v.zoom);
        if (!onCanvas(b.box, lo, v, hi - lo)) continue;
        if (st.shell && st.roof && range.hi > sc.floor) {
          ctx.setTransform(
            r * s,
            0,
            0,
            r * s,
            r * (b.ox * s + v.offsetX),
            r * (b.oy * s + v.offsetY - hi),
          );
          ctx.globalAlpha = st.shellOpacity;
          ctx.strokeStyle = st.shellColor;
          ctx.lineWidth = st.shellWeight / s;
          ctx.lineJoin = 'round';
          ctx.stroke(b.roof);
        }
        if (labels && range.floors.length > 1) {
          ctx.setTransform(r, 0, 0, r, 0, 0);
          const x = b.box[2] * s + v.offsetX + 6;
          const yMid = ((b.box[1] + b.box[3]) / 2) * s + v.offsetY;
          for (const f of range.floors)
            drawLabel(
              ctx,
              css!,
              b.labels.get(f) ?? String(f),
              x,
              yMid - floorShift(sc, f, b.lat, v.zoom),
              f === sc.floor,
            );
        }
      }
    }

    /** Outline of each building's stack: the union of its footprint at the lowest and highest floor and the band between. */
    function drawShell(ctx: CanvasRenderingContext2D, v: SceneView) {
      const sc = scene.current;
      if (!sc || !sc.style.shell || v.zoom < MIN_ZOOM) return;
      const s = v.scale;
      const path = new Path2D();
      let any = false;
      for (const b of sc.buildings) {
        const range = stackOf(sc, b);
        if (!range || range.lo === range.hi) continue;
        const lo = floorShift(sc, range.lo, b.lat, v.zoom);
        const hi = floorShift(sc, range.hi, b.lat, v.zoom);
        if (!onCanvas(b.box, lo, v, hi - lo)) continue;
        any = true;
        for (const ring of b.rings) {
          // In CSS pixels; every part wound the same way, so the nonzero fill is their union.
          const n = ring.length / 2;
          const xs = new Array<number>(n);
          const ys = new Array<number>(n);
          for (let i = 0; i < n; i++) {
            xs[i] = (b.ox + ring[2 * i]) * s + v.offsetX;
            ys[i] = (b.oy + ring[2 * i + 1]) * s + v.offsetY;
          }
          addPositive(
            path,
            xs,
            ys.map((y) => y - lo),
          );
          addPositive(
            path,
            xs,
            ys.map((y) => y - hi),
          );
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            if (Math.abs(xs[j] - xs[i]) < 0.01) continue;
            addPositive(
              path,
              [xs[i], xs[j], xs[j], xs[i]],
              [ys[i] - lo, ys[j] - lo, ys[j] - hi, ys[i] - hi],
            );
          }
        }
      }
      if (!any) return;
      const st = sc.style;
      ctx.setTransform(v.ratio, 0, 0, v.ratio, 0, 0);
      ctx.lineJoin = 'round';
      // Stroke every part twice as wide, then cut away the inside: what is left is the outer half of the union's outline.
      ctx.globalAlpha = st.shellOpacity;
      ctx.strokeStyle = st.shellColor;
      ctx.lineWidth = 2 * st.shellWeight;
      ctx.stroke(path);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fill(path);
      ctx.globalCompositeOperation = 'source-over';
      if (st.shellFill > 0) {
        ctx.globalAlpha = st.shellFill;
        ctx.fillStyle = st.shellColor;
        ctx.fill(path);
      }
    }

    function drawableOf(
      sc: Scene,
      level: LevelInfo,
      rooms: boolean,
      lines: boolean,
    ): LevelDrawable {
      const plan = sc.plans.get(level.id);
      let d = drawables.current.get(level.id);
      if (!d || d.paint !== sc.paint || d.plan !== plan) {
        d = {
          paint: sc.paint,
          plan,
          outline: outlineBatch(level, sc.paint),
          rooms: null,
          lines: null,
        };
        drawables.current.set(level.id, d);
      }
      if (rooms && plan && !d.rooms)
        d.rooms = roomBatches(level, plan, sc.paint);
      if (lines && plan && !d.lines)
        d.lines = lineBatches(level, plan, sc.paint);
      return d;
    }
  }, []);

  useEffect(() => {
    for (const [name, z] of [SHELL_PANE, BELOW_PANE, ABOVE_PANE]) {
      if (map.getPane(name)) continue;
      const pane = map.createPane(name);
      pane.style.zIndex = String(z);
      pane.style.pointerEvents = 'none';
    }
    for (const l of layers) l.addTo(map);
    return () => void layers.forEach((l) => l.remove());
  }, [map, layers]);

  // Redraw (no rebuild) whenever something drawn changes.
  useEffect(() => {
    scene.current = { floor, style, paint, levels, current, plans, buildings };
    hovered.current = null;
    for (const l of layers) l.redraw();
  }, [layers, floor, style, paint, levels, current, plans, buildings]);

  // Clicking a floor that sticks out of the stack switches to it; hovering one lights it up.
  const switchTo = useRef(onFloorChange);
  switchTo.current = onFloorChange;
  useEffect(() => {
    const container = map.getContainer();
    const tooltip = L.tooltip({
      direction: 'top',
      offset: [0, -12],
      opacity: 0.95,
    });
    const hitAt = (e: MouseEvent) => {
      const sc = scene.current;
      const target = e.target as Element;
      if (!sc || map.getZoom() < MIN_ZOOM || !container.contains(target))
        return null;
      // Controls, pins, workspace outlines and plan rooms keep their own clicks; so do the admin click modes.
      if (
        target.closest(
          '.leaflet-control, .floor-picker, .leaflet-marker-icon, .leaflet-popup, .leaflet-tooltip, .leaflet-interactive',
        )
      )
        return null;
      // A click-to-zoom zone under the pointer wins (NavZones marks its hover on the container).
      if (
        ['is-placing', 'is-picking', 'nav-hover'].some((c) =>
          container.classList.contains(c),
        )
      )
        return null;
      return levelAt(sc, map, map.mouseEventToContainerPoint(e));
    };
    const show = (level: LevelInfo | null, e?: MouseEvent) => {
      const f = level?.floor ?? null;
      container.style.cursor = level ? 'pointer' : '';
      if (level && e) {
        tooltip
          .setLatLng(map.mouseEventToLatLng(e))
          .setContent(`Switch to ${levelName(level.id)}`);
        if (!map.hasLayer(tooltip)) map.openTooltip(tooltip);
      } else if (map.hasLayer(tooltip)) map.closeTooltip(tooltip);
      if (f === hovered.current) return;
      hovered.current = f;
      layers[1].redraw();
      layers[2].redraw();
    };
    const dragged = () =>
      !!(map.dragging as L.Handler & { moved?: () => boolean }).moved?.();
    // Leaflet's map click comes last: a zone click never gets here (NavZones stops it first), and a click
    // that hit a layer arrives with that layer as its source (or not at all when the layer doesn't bubble).
    const onClick = (e: L.LeafletMouseEvent) => {
      if (e.sourceTarget !== map || dragged()) return;
      const level = hitAt(e.originalEvent);
      if (!level) return;
      show(null);
      switchTo.current(level.floor);
    };
    const onMove = (e: MouseEvent) =>
      show(e.buttons || dragged() ? null : hitAt(e), e);
    const onLeave = () => show(null);
    map.on('click', onClick);
    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);
    map.on('movestart zoomstart', onLeave);
    return () => {
      map.off('click', onClick);
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseleave', onLeave);
      map.off('movestart zoomstart', onLeave);
      show(null);
    };
  }, [map, layers]);

  // Page Up / Page Down step through the floors of the buildings in view.
  useEffect(() => {
    const floorsHere = [
      ...new Set(
        index.levels.filter((l) => intersects(l.bbox, box)).map((l) => l.floor),
      ),
    ].sort((a, b) => a - b);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      const next =
        e.key === 'PageUp'
          ? floorsHere.find((f) => f > floor)
          : [...floorsHere].reverse().find((f) => f < floor);
      if (next === undefined) return;
      e.preventDefault();
      onFloorChange(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, box, floor, onFloorChange]);

  return null;
}

// ---- placement ---------------------------------------------------------------

/**
 * The floor whose sticking-out part is at a container point: none inside the selected floor; else the
 * nearest floor below that contains the point (the front of the stack), failing that the nearest above.
 */
function levelAt(sc: Scene, map: L.Map, p: L.Point): LevelInfo | null {
  const zoom = map.getZoom();
  const s = 2 ** (zoom - BASE_ZOOM);
  const abs = map.containerPointToLayerPoint(p).add(map.getPixelOrigin());
  const x = abs.x / s;
  const y = abs.y / s;
  const inside = (level: LevelInfo, dy: number) => {
    const pl = placeLevel(level);
    const ly = y + dy / s;
    if (x < pl.box[0] || x > pl.box[2] || ly < pl.box[1] || ly > pl.box[3])
      return false;
    return hitContext().isPointInPath(hitPath(level), x - pl.ox, ly - pl.oy);
  };
  if (sc.current.some((l) => inside(l, 0))) return null;
  let best: { level: LevelInfo; rank: number } | null = null;
  for (const level of sc.levels) {
    const rank =
      level.floor < sc.floor
        ? sc.floor - level.floor
        : 1000 + level.floor - sc.floor;
    if (best && rank >= best.rank) continue;
    if (inside(level, floorShift(sc, level.floor, placeLevel(level).lat, zoom)))
      best = { level, rank };
  }
  return best?.level ?? null;
}

let hitCtx: CanvasRenderingContext2D | null = null;
const hitContext = () =>
  (hitCtx ??= document.createElement('canvas').getContext('2d')!);

const hitPaths = new Map<string, Path2D>();
function hitPath(level: LevelInfo): Path2D {
  let path = hitPaths.get(level.id);
  if (!path) {
    path = new Path2D();
    for (const rings of projectPolys(
      outlineToLatLngs(level.outline),
      placeLevel(level),
    ))
      for (const r of rings) addRing(path, r, true);
    hitPaths.set(level.id, path);
  }
  return path;
}

/** Upward screen offset of a floor in CSS pixels at `zoom`. */
const floorShift = (sc: Scene, f: number, lat: number, zoom: number) =>
  ((f - sc.floor) * sc.style.spacing) / metersPerPixel(lat, zoom);

/** Whether a box, moved up by `dy` (and stretched up by `extra`), touches the canvas. */
function onCanvas(box: Placed['box'], dy: number, v: SceneView, extra = 0) {
  const x0 = box[0] * v.scale + v.offsetX;
  const x1 = box[2] * v.scale + v.offsetX;
  const yTop = box[1] * v.scale + v.offsetY - dy - Math.max(0, extra);
  const yBottom = box[3] * v.scale + v.offsetY - dy - Math.min(0, extra);
  return x1 >= 0 && x0 <= v.width && yBottom >= 0 && yTop <= v.height;
}

/** A building's lowest and highest floor shown. */
function stackOf(sc: Scene, b: Building) {
  const floors = b.floors.filter(
    (f) =>
      f === sc.floor ||
      (Math.abs(f - sc.floor) <= sc.style.range &&
        (sc.style.showAbove || f < sc.floor)),
  );
  return floors.length
    ? { floors, lo: floors[0], hi: floors[floors.length - 1] }
    : null;
}

function place(
  west: number,
  south: number,
  east: number,
  north: number,
): Placed {
  const ox = projectX(west);
  const oy = projectY(north);
  return {
    ox,
    oy,
    box: [ox, oy, projectX(east), projectY(south)],
    lat: (south + north) / 2,
  };
}

const placedLevels = new Map<string, Placed>();
function placeLevel(level: LevelInfo): Placed {
  let p = placedLevels.get(level.id);
  if (!p) placedLevels.set(level.id, (p = place(...level.bbox)));
  return p;
}

function buildBuildings(index: FloorIndex): Building[] {
  const levelsOf = new Map<string, LevelInfo[]>();
  for (const l of index.levels)
    (
      levelsOf.get(l.facilityId) ??
      levelsOf.set(l.facilityId, []).get(l.facilityId)!
    ).push(l);
  return index.facilities.flatMap((f) => {
    const levels = levelsOf.get(f.id);
    if (!levels) return [];
    let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of f.outline.coordinates) {
      for (const [lng, lat] of poly[0]) {
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
    }
    const p = place(west, south, east, north);
    const rings = outlineToLatLngs(f.outline).map((poly) =>
      projectRing(poly[0], p.ox, p.oy),
    );
    const roof = new Path2D();
    for (const r of rings) addRing(roof, r, true);
    const floors = [...new Set(levels.map((l) => l.floor))].sort(
      (a, b) => a - b,
    );
    const labels = new Map(
      floors.map((fl) => [
        fl,
        [...new Set(levels.filter((l) => l.floor === fl).map((l) => l.label))]
          .sort()
          .join('/'),
      ]),
    );
    return [{ ...p, id: f.id, rings, roof, floors, labels }];
  });
}

function addPositive(path: Path2D, xs: number[], ys: number[]) {
  let a = 0;
  for (let i = 0, n = xs.length; i < n; i++) {
    const j = (i + 1) % n;
    a += xs[i] * ys[j] - xs[j] * ys[i];
  }
  const order =
    a >= 0 ? xs.map((_, i) => i) : xs.map((_, i) => xs.length - 1 - i);
  path.moveTo(xs[order[0]], ys[order[0]]);
  for (let k = 1; k < order.length; k++)
    path.lineTo(xs[order[k]], ys[order[k]]);
  path.closePath();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  text: string,
  x: number,
  y: number,
  current: boolean,
) {
  const accent = css.getPropertyValue('--accent').trim() || '#215caf';
  ctx.font = '600 10px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 8;
  const h = 14;
  ctx.globalAlpha = current ? 1 : 0.85;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, 4);
  ctx.fillStyle = current
    ? accent
    : css.getPropertyValue('--panel').trim() || '#fff';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = current
    ? accent
    : css.getPropertyValue('--border').trim() || '#ccc';
  ctx.stroke();
  ctx.fillStyle = current
    ? '#fff'
    : css.getPropertyValue('--muted').trim() || '#666';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 4, y + 0.5);
}

// ---- batches -----------------------------------------------------------------

/** Projected geometry, kept across style changes (keyed by what shapes it). */
const outlineGeom = new Map<string, { key: string; polys: Flat[][] }>();
const roomGeom = new WeakMap<
  LevelPlan,
  { key: string; rooms: { polys: Flat[][]; small: boolean }[] }
>();
const lineGeom = new WeakMap<
  LevelPlan,
  { key: string; lines: [LineLayer, Flat[]][] }
>();

const geometryKey = (m: MinimalStyle | null) =>
  `${m?.cornerRadius ?? 0}|${m?.minSize ?? 0}`;

function projectPolys(polys: L.LatLngTuple[][][], p: Placed) {
  return polys.map((rings) =>
    windPolygon(rings.map((r) => projectRing(r, p.ox, p.oy))),
  );
}

function batch(
  polys: Flat[][],
  paint: Omit<Batch, 'path'>,
  closed: boolean,
): Batch {
  const path = new Path2D();
  for (const rings of polys) for (const r of rings) addRing(path, r, closed);
  return { ...paint, path };
}

function outlineBatch(level: LevelInfo, paint: Paint): Batch | null {
  const m = paint.minimal;
  const opts: L.PathOptions | null = m
    ? m.parts.levels.show
      ? partPathOptions(m, 'levels')
      : null
    : {
        color: BUILDING_STYLE[paint.theme].levelColor,
        weight: 1.5,
        fillColor: BUILDING_STYLE[paint.theme].levelFill,
        fillOpacity: 0.9,
      };
  if (!opts) return null;
  const key = geometryKey(m);
  let g = outlineGeom.get(level.id);
  if (!g || g.key !== key) {
    const latlngs = outlineToLatLngs(level.outline);
    const polys = polygonsSmallerThan(latlngs, m?.minSize ?? 0)
      ? []
      : projectPolys(
          roundPolygons(latlngs, m?.cornerRadius ?? 0),
          placeLevel(level),
        );
    outlineGeom.set(level.id, (g = { key, polys }));
  }
  return g.polys.length ? batch(g.polys, paintOf(opts, true), true) : null;
}

/** Rooms grouped by paint, in the order the paints first appear (as the plan draws them). */
function roomBatches(level: LevelInfo, plan: LevelPlan, paint: Paint): Batch[] {
  const m = paint.minimal;
  const key = geometryKey(m);
  let g = roomGeom.get(plan);
  if (!g || g.key !== key) {
    const placed = placeLevel(level);
    const rooms = plan.rooms.map((room) => ({
      polys: projectPolys(
        roundPolygons(room.rings, m?.cornerRadius ?? 0),
        placed,
      ),
      small: polygonsSmallerThan(room.rings, m?.minSize ?? 0),
    }));
    roomGeom.set(plan, (g = { key, rooms }));
  }
  const groups = new Map<
    string,
    { paint: Omit<Batch, 'path'>; polys: Flat[][] }
  >();
  plan.rooms.forEach((room, i) => {
    const libraryId = paint.libraryRooms.get(room.id) ?? null;
    const eth = paint.ethRooms?.get(room.id) ?? null;
    const mensa = paint.mensaRooms.get(room.id) ?? null;
    if (!libraryId && !mensa && !eth && g.rooms[i].small) return;
    const opts = asMensaRoom(
      mensa,
      libraryId,
      paint.selectedMensaId,
      false,
      false,
      !!(eth && paint.occupancyStyle),
    )
      ? mensaStyle(mensa!, paint.selectedMensaId)
      : eth && paint.occupancyStyle
        ? occupancyPath(paint.occupancyStyle, eth, false)
        : roomStyle(
            paint.theme,
            room.kind,
            libraryId,
            paint.selectedLibraryId,
            false,
            paint.minimal,
            false,
          );
    const p = paintOf(opts, true);
    // Invisible click targets of the selected floor have no use here.
    if (!p.fill && !p.stroke) return;
    const k = paintKey(p);
    (
      groups.get(k) ?? groups.set(k, { paint: p, polys: [] }).get(k)!
    ).polys.push(...g.rooms[i].polys);
  });
  return [...groups.values()].map((x) => batch(x.polys, x.paint, true));
}

function lineBatches(level: LevelInfo, plan: LevelPlan, paint: Paint): Batch[] {
  const m = paint.minimal;
  const key = `${geometryKey(m)}|${m?.mergeDistance ?? 0}|${m?.mergeAngle ?? 0}`;
  let g = lineGeom.get(plan);
  if (!g || g.key !== key) {
    const placed = placeLevel(level);
    const lines = (
      Object.entries(plan.lines) as [LineLayer, [number, number][][]][]
    ).map(([layer, list]): [LineLayer, Flat[]] => {
      const merged =
        m && m.mergeDistance > 0
          ? mergeParallelEdges(list, m.mergeDistance, m.mergeAngle)
          : list;
      return [
        layer,
        roundLines(
          dropSmallLines(merged, m?.minSize ?? 0),
          m?.cornerRadius ?? 0,
        ).map((l) => projectRing(l, placed.ox, placed.oy)),
      ];
    });
    lineGeom.set(plan, (g = { key, lines }));
  }
  return g.lines.flatMap(([layer, lines]) => {
    if (!lines.length || (m && !m.parts[LINE_PART[layer]].show)) return [];
    const opts = m
      ? partPathOptions(m, LINE_PART[layer])
      : LINE_STYLE[paint.theme][layer];
    return [batch([lines], paintOf(opts, false), false)];
  });
}
