import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import {
  partPathOptions,
  polygonsSmallerThan,
  roundPolygons,
  type MinimalStyle,
  type View3DStyle,
} from './minimalStyle';
import { BUILDING_STYLE, type Theme } from './FloorLayer';
import { floorLift, STACK_ZOOM, type BuildingGroup } from './buildingGroups';
import {
  addRing,
  BASE_ZOOM,
  drawBatch,
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
// the map. Every floor gets its own outline, the group's levels on that floor
// merged, so the stack follows the real shape of the buildings.
// Only the selected floor shows its plan: it is drawn (lifted the same way) by
// FloorLayer, with its rooms, workspaces, pins and whatever else is switched on,
// and keeps its clicks. Every floor below it is drawn here as that outline
// alone, styled as a level outline and faded by its distance to the selected
// floor. Nothing is drawn above the selected floor (the floor wheel goes up
// there). An outline around the stack (each floor's outline swept up to the
// floor above it) ties the floors together.
//
// Speed: nothing here is a Leaflet path. Each floor's outline is projected once
// and kept as one Path2D, rebuilt only when the styles change; panning
// and zooming just redraw it through a canvas transform (see sceneCanvas.ts).
//
// Edges: the real edges of the stacked solid, faint, over the
// floors below. At each floor's level only the outline parts that change
// there (a wall that goes straight on to the next floor is no edge), plus the
// lowest floor's whole outline and a vertical line at every corner. Only the
// parts the viewer sees are drawn: lifting a floor north means looking from
// the south and from above, so a point is hidden when a floor of the stack (or
// the selected floor's slab) lies on its line towards the viewer, one step
// south for every step up.
//
// The part of a floor below that sticks out from under the selected one is a
// click target: clicking it switches to that floor. Click-to-zoom zones and everything else
// clickable (rooms, pins, workspace outlines, dataset items) come first.

// A floor far down the stack still keeps this share of the nearest floor's opacity.
const MIN_FADE = 0.35;

const SHELL_PANE = ['floor-3d-shell', 338] as const;
const BELOW_PANE = ['floor-3d-below', 345] as const;
const EDGE_PANE = ['floor-3d-edges', 348] as const;

/** Opacity and width (px) of the edges. */
const EDGE_OPACITY = 0.3;
const EDGE_WEIGHT = 1;
/** Outline parts closer than this (m) to the other floor's outline continue a wall: no edge. */
const EDGE_TOLERANCE_M = 0.6;
/** Outline parts are tested in pieces of this length (m). */
const EDGE_PIECE_M = 1;
/** A corner turns by more than this (degrees) to get a vertical edge. */
const CORNER_DEG = 15;

interface Props {
  theme: Theme;
  /** The building group stacked; null draws nothing. */
  group: BuildingGroup | null;
  floor: number;
  onFloorChange: (floor: number) => void;
  style: View3DStyle;
  /** The outlines are styled as the selected floor's level outline (see FloorLayer). */
  minimal: MinimalStyle | null;
}

/** What the outline paint depends on; a new object means the cached batch is stale. */
interface Paint {
  theme: Theme;
  minimal: MinimalStyle | null;
}

interface Scene {
  floor: number;
  style: View3DStyle;
  paint: Paint;
  stack: Stack;
  /** Floors drawn below the selected one (which is FloorLayer's), ascending. */
  floors: number[];
  /** Lowest floor of the stack. */
  lo: number;
}

/** Projected shape: origin and bounds in BASE_ZOOM pixels, geometry relative to the origin. */
interface Placed {
  ox: number;
  oy: number;
  /** Absolute bounds [x0, y0, x1, y1] (y grows southward). */
  box: [number, number, number, number];
  lat: number;
}

/** The group's placement; every floor is projected from the same origin. */
interface Stack extends Placed {
  group: BuildingGroup;
  /** Per floor, built on first use. */
  shapes: Map<number, FloorShape>;
}

/** One floor's outline, projected. */
interface FloorShape {
  /** Outer rings, for the shell. */
  rings: Flat[];
  /** Every ring, holes too, for the edges. */
  all: Flat[];
  /** Every polygon with its holes, for clicks. */
  hit: Path2D;
}

export function Floors3D({
  theme,
  group,
  floor,
  onFloorChange,
  style,
  minimal,
}: Props) {
  const map = useMap();

  const stack = useMemo(() => (group ? buildStack(group) : null), [group]);

  // Every floor of the group below the selected one.
  const floors = useMemo(
    () => (group?.floors ?? []).filter((f) => f < floor),
    [group, floor],
  );

  // A slider of the 3D section must not count as a change of the plan styles.
  const minimalKey = minimal
    ? JSON.stringify({ ...minimal, view3d: null })
    : '';
  const paint = useMemo<Paint>(() => ({ theme, minimal }), [theme, minimalKey]);

  const scene = useRef<Scene | null>(null);

  const layers = useMemo(() => {
    const shell = sceneCanvas(SHELL_PANE[0], drawShell);
    const below = sceneCanvas(BELOW_PANE[0], drawFloors);
    const edgeLayer = sceneCanvas(EDGE_PANE[0], drawEdges);
    return [shell, below, edgeLayer];

    /** The real edges of the stack from the lowest floor up to the selected one. */
    function drawEdges(ctx: CanvasRenderingContext2D, v: SceneView) {
      const sc = scene.current;
      if (!sc || !sc.floors.length || v.zoom < STACK_ZOOM) return;
      const st = sc.stack;
      const s = v.scale;
      const lo = liftPx(sc, sc.lo) * s;
      const hi = liftPx(sc, sc.floor) * s;
      if (!onCanvas(st.box, lo, v, hi - lo)) return;
      const path = visibleEdges(sc);
      const r = v.ratio;
      ctx.setTransform(
        r * s,
        0,
        0,
        r * s,
        r * (st.ox * s + v.offsetX),
        r * (st.oy * s + v.offsetY),
      );
      ctx.globalAlpha = EDGE_OPACITY;
      ctx.strokeStyle = sc.style.shellColor;
      ctx.lineWidth = EDGE_WEIGHT / s;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(path);
    }

    function drawFloors(ctx: CanvasRenderingContext2D, v: SceneView) {
      const sc = scene.current;
      if (!sc || v.zoom < STACK_ZOOM) return;
      const st = sc.stack;
      const r = v.ratio;
      const s = v.scale;
      // Every floor below is its own outline alone.
      for (const f of sc.floors) {
        const slab = outlineBatch(st.group, f, sc.paint);
        if (!slab) continue;
        const dy = liftPx(sc, f) * s;
        if (!onCanvas(st.box, dy, v)) continue;
        // On a scratch canvas faded as a whole, so fill and stroke don't add up their alpha.
        const off = v.scratch();
        off.setTransform(
          r * s,
          0,
          0,
          r * s,
          r * (st.ox * s + v.offsetX),
          r * (st.oy * s + v.offsetY - dy),
        );
        drawBatch(off, slab, s);
        // Fades with the distance, but never so far that the lowest floors vanish.
        const fade = Math.max(sc.style.falloff ** (sc.floor - f - 1), MIN_FADE);
        ctx.globalAlpha = sc.style.ghostOpacity * fade;
        ctx.drawImage(off.canvas, 0, 0);
      }
    }

    /** Outline of the stack: the union of every floor's outline swept from its place up to the floor above it. */
    function drawShell(ctx: CanvasRenderingContext2D, v: SceneView) {
      const sc = scene.current;
      if (!sc || !sc.style.shell || v.zoom < STACK_ZOOM || sc.lo === sc.floor)
        return;
      const b = sc.stack;
      const s = v.scale;
      const lo = liftPx(sc, sc.lo) * s;
      const hi = liftPx(sc, sc.floor) * s;
      if (!onCanvas(b.box, lo, v, hi - lo)) return;
      const path = new Path2D();
      const top = b.group.floors.includes(sc.floor)
        ? [...sc.floors, sc.floor]
        : sc.floors;
      top.forEach((f, k) => {
        const from = liftPx(sc, f) * s;
        const to = k + 1 < top.length ? liftPx(sc, top[k + 1]) * s : from;
        for (const ring of floorShape(b, f).rings) {
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
            ys.map((y) => y - from),
          );
          if (to === from) continue;
          addPositive(
            path,
            xs,
            ys.map((y) => y - to),
          );
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            if (Math.abs(xs[j] - xs[i]) < 0.01) continue;
            addPositive(
              path,
              [xs[i], xs[j], xs[j], xs[i]],
              [ys[i] - from, ys[j] - from, ys[j] - to, ys[i] - to],
            );
          }
        }
      });
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
  }, []);

  useEffect(() => {
    for (const [name, z] of [SHELL_PANE, BELOW_PANE, EDGE_PANE]) {
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
    scene.current = stack
      ? {
          floor,
          style,
          paint,
          stack,
          floors,
          lo: floors.length ? floors[0] : floor,
        }
      : null;
    for (const l of layers) l.redraw();
  }, [layers, floor, style, paint, stack, floors]);

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

  // Page Up / Page Down step through the floors of the stacked group.
  useEffect(() => {
    const floorsHere = group?.floors ?? [];
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
  }, [group, floor, onFloorChange]);

  return null;
}

// ---- placement ---------------------------------------------------------------

/**
 * The floor whose sticking-out part is at a container point: none inside the selected floor; else the
 * nearest floor below that contains the point (the front of the stack).
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
    return hitContext().isPointInPath(
      floorShape(st, f).hit,
      x - st.ox,
      ly - st.oy,
    );
  };
  if (st.group.floors.includes(sc.floor) && inside(sc.floor)) return null;
  // Nearest first.
  for (let i = sc.floors.length - 1; i >= 0; i--)
    if (inside(sc.floors[i])) return sc.floors[i];
  return null;
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

const stacks = new WeakMap<BuildingGroup, Stack>();
function buildStack(group: BuildingGroup): Stack {
  let st = stacks.get(group);
  if (st) return st;
  const p = place(...group.bbox);
  stacks.set(group, (st = { ...p, group, shapes: new Map() }));
  return st;
}

function floorShape(st: Stack, floor: number): FloorShape {
  let shape = st.shapes.get(floor);
  if (shape) return shape;
  const latlngs = st.group.floorOutline(floor);
  const rings = latlngs.map((poly) => projectRing(poly[0], st.ox, st.oy));
  const polys = projectPolys(latlngs, st);
  const hit = new Path2D();
  for (const rs of polys) for (const r of rs) addRing(hit, r, true);
  st.shapes.set(floor, (shape = { rings, all: polys.flat(), hit }));
  return shape;
}

// ---- edges -------------------------------------------------------------------

/** A line [x1, y1, x2, y2] in a stack's projected coordinates. */
type Seg = [number, number, number, number];

/** BASE_ZOOM pixels per meter at a latitude. */
const pxPerM = (lat: number) =>
  2 ** BASE_ZOOM / (156_543.034 * Math.cos((lat * Math.PI) / 180));

function segmentsOf(shape: FloorShape): Seg[] {
  const out: Seg[] = [];
  for (const r of shape.all) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push([r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1]]);
    }
  }
  return out;
}

/** Segments bucketed by grid cell, for "is this point on that outline" tests. */
function segmentGrid(segs: Seg[], cell: number, pad: number) {
  const grid = new Map<string, Seg[]>();
  for (const sg of segs) {
    const x0 = Math.floor((Math.min(sg[0], sg[2]) - pad) / cell);
    const x1 = Math.floor((Math.max(sg[0], sg[2]) + pad) / cell);
    const y0 = Math.floor((Math.min(sg[1], sg[3]) - pad) / cell);
    const y1 = Math.floor((Math.max(sg[1], sg[3]) + pad) / cell);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(sg);
      }
  }
  return (x: number, y: number, tol: number) => {
    for (const [ax, ay, bx, by] of grid.get(
      `${Math.floor(x / cell)},${Math.floor(y / cell)}`,
    ) ?? []) {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2
        ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2))
        : 0;
      if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= tol) return true;
    }
    return false;
  };
}

/** The parts of `segs` that don't lie on the outline `near` tests, merged into runs. */
function offOutline(
  segs: Seg[],
  near: (x: number, y: number, tol: number) => boolean,
  piece: number,
  tol: number,
): Seg[] {
  const out: Seg[] = [];
  for (const [ax, ay, bx, by] of segs) {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / piece));
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const t = (i + 0.5) / n;
      const off = i < n && !near(ax + t * (bx - ax), ay + t * (by - ay), tol);
      if (off && start < 0) start = i;
      if (!off && start >= 0) {
        out.push([
          ax + (start / n) * (bx - ax),
          ay + (start / n) * (by - ay),
          ax + (i / n) * (bx - ax),
          ay + (i / n) * (by - ay),
        ]);
        start = -1;
      }
    }
  }
  return out;
}

const edgeCache = new WeakMap<Stack, Map<string, Seg[]>>();

/**
 * The edges at the level of `floor` (sitting on `below`, null for the lowest
 * floor): the parts of either outline the other one doesn't continue.
 */
function levelEdges(st: Stack, below: number | null, floor: number): Seg[] {
  let cache = edgeCache.get(st);
  if (!cache) edgeCache.set(st, (cache = new Map()));
  const key = `${below}|${floor}`;
  let out = cache.get(key);
  if (out) return out;
  const upper = segmentsOf(floorShape(st, floor));
  if (below === null) out = upper;
  else {
    const lower = segmentsOf(floorShape(st, below));
    const m = pxPerM(st.lat);
    const tol = EDGE_TOLERANCE_M * m;
    const piece = EDGE_PIECE_M * m;
    const cell = 20 * m;
    out = [
      ...offOutline(upper, segmentGrid(lower, cell, tol), piece, tol),
      ...offOutline(lower, segmentGrid(upper, cell, tol), piece, tol),
    ];
  }
  cache.set(key, out);
  return out;
}

/** A floor of the stack as an occluder: its outline from height z0 up to z1 (equal for the top slab). */
interface Block {
  shape: FloorShape;
  z0: number;
  z1: number;
}

const columnCache = new WeakMap<FloorShape, Map<number, Seg[]>>();

/** A floor's outline segments bucketed by x column, for vertical line crossings. */
function columns(shape: FloorShape, width: number) {
  let cols = columnCache.get(shape);
  if (cols) return cols;
  cols = new Map();
  for (const sg of segmentsOf(shape)) {
    const c0 = Math.floor(Math.min(sg[0], sg[2]) / width);
    const c1 = Math.floor(Math.max(sg[0], sg[2]) / width);
    for (let c = c0; c <= c1; c++)
      (cols.get(c) ?? cols.set(c, []).get(c)!).push(sg);
  }
  columnCache.set(shape, cols);
  return cols;
}

/** Whether the north-south line at x, from y = a to b (a <= b), touches the inside of a floor's outline. */
function crossesShape(
  shape: FloorShape,
  width: number,
  x: number,
  a: number,
  b: number,
) {
  const ys: number[] = [];
  for (const [x1, y1, x2, y2] of columns(shape, width).get(
    Math.floor(x / width),
  ) ?? [])
    if (x1 <= x !== x2 <= x) ys.push(y1 + ((x - x1) * (y2 - y1)) / (x2 - x1));
  ys.sort((p, q) => p - q);
  // Even-odd: the line is inside between each pair of crossings.
  for (let i = 0; i + 1 < ys.length; i += 2)
    if (ys[i] <= b && ys[i + 1] >= a) return true;
  return false;
}

/** Whether a point (in plan, at height z) is hidden from the viewer by a block. */
function hidden(
  blocks: Block[],
  width: number,
  eps: number,
  x: number,
  y: number,
  z: number,
) {
  // Towards the viewer: (x, y + t) at height z + t, for t > 0.
  for (const b of blocks) {
    const t0 = Math.max(eps, b.z0 - z);
    const t1 = b.z1 - z;
    if (t1 < t0) continue;
    if (crossesShape(b.shape, width, x, y + t0, y + t1)) return true;
  }
  return false;
}

const visibleCache = new WeakMap<Stack, Map<string, Path2D>>();

/** The edges of the stack the viewer sees, as one path in the stack's projected coordinates. */
function visibleEdges(sc: Scene): Path2D {
  const st = sc.stack;
  let cache = visibleCache.get(st);
  if (!cache) visibleCache.set(st, (cache = new Map()));
  const key = `${sc.floor}|${sc.style.spacing}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const levels = st.group.floors.includes(sc.floor)
    ? [...sc.floors, sc.floor]
    : sc.floors;
  const z = levels.map((f) => liftPx(sc, f));
  const blocks: Block[] = levels.map((f, k) => ({
    shape: floorShape(st, f),
    z0: z[k],
    z1: z[k + 1] ?? z[k],
  }));
  const m = pxPerM(st.lat);
  const width = 5 * m;
  const eps = 0.3 * m;
  const piece = EDGE_PIECE_M * m;
  const path = new Path2D();
  const seen = (x: number, y: number, h: number) =>
    !hidden(blocks, width, eps, x, y, h);

  /** Draws the visible runs of a 3D line, tested piece by piece at their midpoints. */
  const line = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(1, Math.ceil(len / piece));
    const at = (t: number) =>
      [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)] as const;
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && seen(...at((i + 0.5) / n));
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        const [x0, y0, z0] = at(start / n);
        const [x1, y1, z1] = at(i / n);
        path.moveTo(x0, y0 - z0);
        path.lineTo(x1, y1 - z1);
        start = -1;
      }
    }
  };

  levels.forEach((f, k) => {
    // The outline parts that change at this floor's level, in place.
    for (const [x1, y1, x2, y2] of levelEdges(st, levels[k - 1] ?? null, f))
      line(x1, y1, z[k], x2, y2, z[k]);
    // A vertical edge at every corner, up to the next floor.
    if (k + 1 >= levels.length) return;
    for (const [x, y] of corners(floorShape(st, f)))
      line(x, y, z[k], x, y, z[k + 1]);
  });
  cache.set(key, path);
  return path;
}

const cornerCache = new WeakMap<FloorShape, [number, number][]>();

/** The vertices of a floor's outline where it turns: the foot of a vertical edge. */
function corners(shape: FloorShape): [number, number][] {
  let out = cornerCache.get(shape);
  if (out) return out;
  out = [];
  const minTurn = Math.sin((CORNER_DEG * Math.PI) / 180);
  for (const r of shape.all) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n;
      const q = (i + 1) % n;
      const ax = r[2 * i] - r[2 * p];
      const ay = r[2 * i + 1] - r[2 * p + 1];
      const bx = r[2 * q] - r[2 * i];
      const by = r[2 * q + 1] - r[2 * i + 1];
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (!la || !lb) continue;
      const cross = (ax * by - ay * bx) / (la * lb);
      const dot = (ax * bx + ay * by) / (la * lb);
      if (Math.abs(cross) > minTurn || dot < 0)
        out.push([r[2 * i], r[2 * i + 1]]);
    }
  }
  cornerCache.set(shape, out);
  return out;
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

// ---- batches -----------------------------------------------------------------

/** Projected geometry, kept across style changes (keyed by what shapes it). */
const outlineGeom = new Map<string, { key: string; polys: Flat[][] }>();

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
  Map<number, { paint: Paint; batch: Batch | null }>
>();

/** One floor's outline, styled as a level outline: that floor's slab. */
function outlineBatch(
  group: BuildingGroup,
  floor: number,
  paint: Paint,
): Batch | null {
  let perFloor = outlineBatches.get(group);
  if (!perFloor) outlineBatches.set(group, (perFloor = new Map()));
  const cached = perFloor.get(floor);
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
  const id = `${group.id}|${floor}`;
  let g = outlineGeom.get(id);
  if (!g || g.key !== key) {
    const latlngs = group.floorOutline(floor);
    const polys = polygonsSmallerThan(latlngs, m?.minSize ?? 0)
      ? []
      : projectPolys(
          roundPolygons(latlngs, m?.cornerRadius ?? 0),
          buildStack(group),
        );
    outlineGeom.set(id, (g = { key, polys }));
  }
  const out = g.polys.length ? batch(g.polys, paintOf(opts, true), true) : null;
  perFloor.set(floor, { paint, batch: out });
  return out;
}
