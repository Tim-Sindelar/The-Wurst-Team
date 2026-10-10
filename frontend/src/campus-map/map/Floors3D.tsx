import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { useMap, useMapEvents } from 'react-leaflet';
import {
  intersects,
  loadLevel,
  type FloorIndex,
  type LevelInfo,
  type LevelPlan,
  type LineLayer,
} from '../floors/floorData';
import {
  dropSmallLines,
  mergeParallelEdges,
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
import { floorLift, STACK_ZOOM, type BuildingGroup } from './buildingGroups';
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

// Pseudo-3D view of the building group in focus (see buildingGroups.ts): its
// floors are stacked, each moved north by `spacing` meters per floor above the
// group's ground floor, so the ground floor matches the building footprints of
// the map. Every floor gets the same outline, the group's whole footprint.
// The selected floor is drawn (lifted the same way) by FloorLayer, so it keeps
// its clicks, markers and outlines; the other floors are drawn here with the
// same styles, each on a scratch canvas faded as a whole (so overlapping shapes
// don't add up their alpha). Floors below sit under the selected one, floors
// above lie over it. An outline around the stack (the footprint swept from the
// lowest to the highest floor shown) ties the floors together.
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

const LABEL_ZOOM = 18;

const SHELL_PANE = ['floor-3d-shell', 338] as const;
const BELOW_PANE = ['floor-3d-below', 345] as const;
const ABOVE_PANE = ['floor-3d-above', 365] as const;

interface Props {
  theme: Theme;
  index: FloorIndex;
  /** The building group stacked; null draws nothing. */
  group: BuildingGroup | null;
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
  stack: Stack;
  /** Other floors drawn (the selected one is FloorLayer's), ascending. */
  floors: number[];
  /** Lowest and highest floor of the stack, the selected one included. */
  lo: number;
  hi: number;
  /** Levels of the other floors drawn. */
  levels: LevelInfo[];
  plans: ReadonlyMap<string, LevelPlan>;
}

/** Projected shape: origin and bounds in BASE_ZOOM pixels, geometry relative to the origin. */
interface Placed {
  ox: number;
  oy: number;
  /** Absolute bounds [x0, y0, x1, y1] (y grows southward). */
  box: [number, number, number, number];
  lat: number;
}

/** The group's outline, projected. */
interface Stack extends Placed {
  group: BuildingGroup;
  /** Outer rings (shell, roof). */
  rings: Flat[];
  roof: Path2D;
  /** Every polygon with its holes, for clicks. */
  hit: Path2D;
}

interface LevelDrawable {
  paint: Paint;
  plan: LevelPlan | undefined;
  rooms: Batch[] | null;
  lines: Batch[] | null;
}

export function Floors3D({
  theme,
  index,
  group,
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

  const stack = useMemo(() => (group ? buildStack(group) : null), [group]);

  // Floors of the group shown, apart from the selected one.
  const floors = useMemo(
    () =>
      (group?.floors ?? []).filter(
        (f) =>
          f !== floor &&
          Math.abs(f - floor) <= style.range &&
          (style.showAbove || f < floor),
      ),
    [group, floor, style.range, style.showAbove],
  );
  const levels = useMemo(
    () => (group?.levels ?? []).filter((l) => floors.includes(l.floor)),
    [group, floors],
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

  // Plans of the levels in view (after their lift), loaded on demand.
  const loadIds =
    group && view.zoom >= ROOM_ZOOM
      ? levels
          .filter((l) => {
            const d = floorLift(group, l.floor, style.spacing);
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
      if (!sc || v.zoom < STACK_ZOOM) return;
      const st = sc.stack;
      const r = v.ratio;
      const s = v.scale;
      const rooms = v.zoom >= ROOM_ZOOM;
      const lines = rooms && v.zoom >= LINE_ZOOM && sc.style.ghostLines;
      const slab = outlineBatch(st.group, sc.paint);
      for (const f of sc.floors) {
        if (side === 'below' ? f > sc.floor : f < sc.floor) continue;
        const dy = liftPx(sc, f) * s;
        if (!onCanvas(st.box, dy, v)) continue;
        const off = v.scratch();
        // Every floor has the group's whole outline, its rooms on top.
        if (slab) {
          off.setTransform(
            r * s,
            0,
            0,
            r * s,
            r * (st.ox * s + v.offsetX),
            r * (st.oy * s + v.offsetY - dy),
          );
          drawBatch(off, slab, s);
        }
        if (rooms)
          for (const level of sc.levels) {
            if (level.floor !== f) continue;
            const placed = placeLevel(level);
            const d = drawableOf(sc, level, rooms, lines);
            off.setTransform(
              r * s,
              0,
              0,
              r * s,
              r * (placed.ox * s + v.offsetX),
              r * (placed.oy * s + v.offsetY - dy),
            );
            for (const b of d.rooms ?? []) drawBatch(off, b, s);
            if (lines) for (const b of d.lines ?? []) drawBatch(off, b, s);
          }
        const alpha =
          sc.style.ghostOpacity *
          sc.style.falloff ** (Math.abs(f - sc.floor) - 1);
        ctx.globalAlpha = alpha;
        ctx.drawImage(off.canvas, 0, 0);
      }
      if (side === 'above') drawTop(ctx, v, sc);
    }

    /** Roof edge and floor letters, over the whole stack. */
    function drawTop(ctx: CanvasRenderingContext2D, v: SceneView, sc: Scene) {
      const st = sc.style;
      const b = sc.stack;
      const labels = st.floorLabels && v.zoom >= LABEL_ZOOM;
      if (!(st.shell && st.roof) && !labels) return;
      const r = v.ratio;
      const s = v.scale;
      const lo = liftPx(sc, sc.lo) * s;
      const hi = liftPx(sc, sc.hi) * s;
      if (!onCanvas(b.box, lo, v, hi - lo)) return;
      if (st.shell && st.roof && sc.hi > sc.floor) {
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
      if (labels && sc.floors.length) {
        const css = getComputedStyle(document.documentElement);
        ctx.setTransform(r, 0, 0, r, 0, 0);
        const x = b.box[2] * s + v.offsetX + 6;
        const yMid = ((b.box[1] + b.box[3]) / 2) * s + v.offsetY;
        const shown = b.group.floors.includes(sc.floor)
          ? [...sc.floors, sc.floor]
          : sc.floors;
        for (const f of shown)
          drawLabel(
            ctx,
            css,
            b.group.labels.get(f) ?? String(f),
            x,
            yMid - liftPx(sc, f) * s,
            f === sc.floor,
          );
      }
    }

    /** Outline of the stack: the union of its footprint at the lowest and highest floor and the band between. */
    function drawShell(ctx: CanvasRenderingContext2D, v: SceneView) {
      const sc = scene.current;
      if (!sc || !sc.style.shell || v.zoom < STACK_ZOOM || sc.lo === sc.hi)
        return;
      const b = sc.stack;
      const s = v.scale;
      const lo = liftPx(sc, sc.lo) * s;
      const hi = liftPx(sc, sc.hi) * s;
      if (!onCanvas(b.box, lo, v, hi - lo)) return;
      const path = new Path2D();
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
        d = { paint: sc.paint, plan, rooms: null, lines: null };
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
    const all = stack?.group.floors.includes(floor)
      ? [...floors, floor]
      : floors;
    scene.current =
      stack && all.length
        ? {
            floor,
            style,
            paint,
            stack,
            floors,
            lo: Math.min(...all),
            hi: Math.max(...all),
            levels,
            plans,
          }
        : null;
    for (const l of layers) l.redraw();
  }, [layers, floor, style, paint, stack, floors, levels, plans]);

  // Clicking a floor that sticks out of the stack switches to it.
  const switchTo = useRef(onFloorChange);
  switchTo.current = onFloorChange;
  useEffect(() => {
    const container = map.getContainer();
    const hitAt = (e: MouseEvent) => {
      const sc = scene.current;
      const target = e.target as Element;
      if (!sc || map.getZoom() < STACK_ZOOM || !container.contains(target))
        return null;
      // Controls, pins, workspace outlines and plan rooms keep their own clicks; so do the admin click modes.
      if (
        target.closest(
          '.leaflet-control, .floor-wheel, .leaflet-marker-icon, .leaflet-popup, .leaflet-tooltip, .leaflet-interactive',
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
      return floorAt(sc, map, map.mouseEventToContainerPoint(e));
    };
    // Only the cursor tells that a floor can be clicked.
    const show = (f: number | null) => {
      container.style.cursor = f !== null ? 'pointer' : '';
    };
    const dragged = () =>
      !!(map.dragging as L.Handler & { moved?: () => boolean }).moved?.();
    // Leaflet's map click comes last: a zone click never gets here (NavZones stops it first), and a click
    // that hit a layer arrives with that layer as its source (or not at all when the layer doesn't bubble).
    const onClick = (e: L.LeafletMouseEvent) => {
      if (e.sourceTarget !== map || dragged()) return;
      const f = hitAt(e.originalEvent);
      if (f === null) return;
      show(null);
      switchTo.current(f);
    };
    const onMove = (e: MouseEvent) =>
      show(e.buttons || dragged() ? null : hitAt(e));
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
function floorAt(sc: Scene, map: L.Map, p: L.Point): number | null {
  const s = 2 ** (map.getZoom() - BASE_ZOOM);
  const abs = map.containerPointToLayerPoint(p).add(map.getPixelOrigin());
  const x = abs.x / s;
  const y = abs.y / s;
  const st = sc.stack;
  const inside = (f: number) => {
    const ly = y + liftPx(sc, f);
    if (x < st.box[0] || x > st.box[2] || ly < st.box[1] || ly > st.box[3])
      return false;
    return hitContext().isPointInPath(st.hit, x - st.ox, ly - st.oy);
  };
  if (st.group.floors.includes(sc.floor) && inside(sc.floor)) return null;
  let best: { floor: number; rank: number } | null = null;
  for (const f of sc.floors) {
    const rank = f < sc.floor ? sc.floor - f : 1000 + f - sc.floor;
    if (best && rank >= best.rank) continue;
    if (inside(f)) best = { floor: f, rank };
  }
  return best?.floor ?? null;
}

let hitCtx: CanvasRenderingContext2D | null = null;
const hitContext = () =>
  (hitCtx ??= document.createElement('canvas').getContext('2d')!);

/** Northward lift of a floor in BASE_ZOOM pixels: the lift FloorLayer gives the selected floor. */
const liftPx = (sc: Scene, f: number) =>
  projectY(sc.stack.lat) -
  projectY(sc.stack.lat + floorLift(sc.stack.group, f, sc.style.spacing));

/** Whether a box, moved up by `dy` (and stretched up by `extra`), touches the canvas. */
function onCanvas(box: Placed['box'], dy: number, v: SceneView, extra = 0) {
  const x0 = box[0] * v.scale + v.offsetX;
  const x1 = box[2] * v.scale + v.offsetX;
  const yTop = box[1] * v.scale + v.offsetY - dy - Math.max(0, extra);
  const yBottom = box[3] * v.scale + v.offsetY - dy - Math.min(0, extra);
  return x1 >= 0 && x0 <= v.width && yBottom >= 0 && yTop <= v.height;
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

const stacks = new WeakMap<BuildingGroup, Stack>();
function buildStack(group: BuildingGroup): Stack {
  let st = stacks.get(group);
  if (st) return st;
  const p = place(...group.bbox);
  const latlngs = group.outline();
  const rings = latlngs.map((poly) => projectRing(poly[0], p.ox, p.oy));
  const roof = new Path2D();
  for (const r of rings) addRing(roof, r, true);
  const hit = new Path2D();
  for (const rs of projectPolys(latlngs, p))
    for (const r of rs) addRing(hit, r, true);
  stacks.set(group, (st = { ...p, group, rings, roof, hit }));
  return st;
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

const outlineBatches = new WeakMap<
  BuildingGroup,
  { paint: Paint; batch: Batch | null }
>();

/** The group's outline, styled as a level outline: the slab of every floor. */
function outlineBatch(group: BuildingGroup, paint: Paint): Batch | null {
  const cached = outlineBatches.get(group);
  if (cached?.paint === paint) return cached.batch;
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
  let g = outlineGeom.get(group.id);
  if (!g || g.key !== key) {
    const latlngs = group.outline();
    const polys = polygonsSmallerThan(latlngs, m?.minSize ?? 0)
      ? []
      : projectPolys(
          roundPolygons(latlngs, m?.cornerRadius ?? 0),
          buildStack(group),
        );
    outlineGeom.set(group.id, (g = { key, polys }));
  }
  const out = g.polys.length ? batch(g.polys, paintOf(opts, true), true) : null;
  outlineBatches.set(group, { paint, batch: out });
  return out;
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
