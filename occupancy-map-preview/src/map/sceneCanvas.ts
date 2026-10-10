import L from 'leaflet';

// A Leaflet renderer that hands its canvas to a draw callback instead of
// drawing Leaflet paths. Leaflet's Renderer base still positions the canvas,
// follows the zoom animation and fires on every move; the callback draws
// prebuilt Path2D geometry through a canvas transform, so a redraw costs a few
// fill/stroke calls instead of clipping and simplifying thousands of paths.

/** Geometry is projected once, in Web Mercator pixels at this zoom, relative to a per-shape origin. */
export const BASE_ZOOM = 20;
const WORLD = 256 * 2 ** BASE_ZOOM;

export const projectX = (lng: number) => ((lng + 180) / 360) * WORLD;
export function projectY(lat: number) {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
}

export interface SceneView {
  zoom: number;
  /** BASE_ZOOM pixels → CSS pixels on the canvas: x * scale + offsetX. */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Device pixels per CSS pixel. */
  ratio: number;
  /** Offscreen canvas of the same size, for drawing a group that is then faded as a whole. */
  scratch: () => CanvasRenderingContext2D;
}

export type SceneDraw = (ctx: CanvasRenderingContext2D, view: SceneView) => void;

export interface SceneCanvas extends L.Layer {
  redraw(): void;
}

const Base = L.Renderer as unknown as { extend(props: object): new (options: object) => SceneCanvas };
const RendererProto = L.Renderer.prototype as unknown as { _update(this: unknown): void };

const SceneCanvasClass = Base.extend({
  _initContainer(this: Internal) {
    this._container = document.createElement('canvas');
    this._container.style.pointerEvents = 'none';
    this._ctx = this._container.getContext('2d')!;
  },
  _destroyContainer(this: Internal) {
    this._container.remove();
    this._scratch = undefined;
  },
  _update(this: Internal) {
    if (this._map._animatingZoom && this._bounds) return;
    RendererProto._update.call(this);
    const b = this._bounds;
    const size = b.getSize();
    const min = b.min!;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    L.DomUtil.setPosition(this._container, min);
    this._container.width = Math.round(size.x * ratio);
    this._container.height = Math.round(size.y * ratio);
    this._container.style.width = `${size.x}px`;
    this._container.style.height = `${size.y}px`;
    this._ratio = ratio;
    this.redraw();
  },
  // No Leaflet paths live here.
  _updatePaths() {},
  _onZoomEnd() {},
  redraw(this: Internal) {
    if (!this._map || !this._bounds) return;
    if (!this._container.width || !this._container.height) return;
    const ctx = this._ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._container.width, this._container.height);
    const origin = this._map.getPixelOrigin();
    const size = this._bounds.getSize();
    const zoom = this._map.getZoom();
    this.options.draw(ctx, {
      zoom,
      scale: 2 ** (zoom - BASE_ZOOM),
      offsetX: -origin.x - this._bounds.min!.x,
      offsetY: -origin.y - this._bounds.min!.y,
      width: size.x,
      height: size.y,
      ratio: this._ratio,
      scratch: () => {
        const c = (this._scratch ??= document.createElement('canvas'));
        if (c.width !== this._container.width || c.height !== this._container.height) {
          c.width = this._container.width;
          c.height = this._container.height;
        }
        const sctx = c.getContext('2d')!;
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, c.width, c.height);
        return sctx;
      },
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },
});

interface Internal {
  _map: L.Map & { _animatingZoom: boolean };
  _bounds: L.Bounds;
  _container: HTMLCanvasElement;
  _ctx: CanvasRenderingContext2D;
  _scratch?: HTMLCanvasElement;
  _ratio: number;
  options: { draw: SceneDraw };
  redraw(): void;
}

export function sceneCanvas(pane: string, draw: SceneDraw, padding = 0.3): SceneCanvas {
  return new SceneCanvasClass({ pane, padding, draw });
}

// ---- prebuilt paths ----------------------------------------------------------

/** A Path2D in BASE_ZOOM pixels relative to its shape's origin, with how to paint it. */
export interface Batch {
  path: Path2D;
  fill: string | null;
  fillAlpha: number;
  stroke: string | null;
  strokeAlpha: number;
  /** Stroke width in CSS pixels. */
  weight: number;
  join: CanvasLineJoin;
  cap: CanvasLineCap;
}

/** Paint of a Leaflet path, with Leaflet's defaults. */
export function paintOf(o: L.PathOptions, polygon: boolean): Omit<Batch, 'path'> {
  const color = o.color ?? '#3388ff';
  const fill = polygon ? o.fill !== false : !!o.fill;
  const fillAlpha = o.fillOpacity ?? 0.2;
  const stroke = o.stroke !== false && (o.weight ?? 3) > 0 && (o.opacity ?? 1) > 0;
  return {
    fill: fill && fillAlpha > 0 ? (o.fillColor ?? color) : null,
    fillAlpha,
    stroke: stroke ? color : null,
    strokeAlpha: o.opacity ?? 1,
    weight: o.weight ?? 3,
    join: (o.lineJoin as CanvasLineJoin) ?? 'round',
    cap: (o.lineCap as CanvasLineCap) ?? 'round',
  };
}

export const paintKey = (p: Omit<Batch, 'path'>) =>
  `${p.fill}|${p.fillAlpha}|${p.stroke}|${p.strokeAlpha}|${p.weight}|${p.join}|${p.cap}`;

/** Fills (nonzero: rings are wound so holes stay holes and overlaps don't cancel) then strokes. */
export function drawBatch(ctx: CanvasRenderingContext2D, b: Batch, scale: number) {
  if (b.fill) {
    ctx.globalAlpha = b.fillAlpha;
    ctx.fillStyle = b.fill;
    ctx.fill(b.path);
  }
  if (b.stroke) {
    ctx.globalAlpha = b.strokeAlpha;
    ctx.strokeStyle = b.stroke;
    ctx.lineWidth = b.weight / scale;
    ctx.lineJoin = b.join;
    ctx.lineCap = b.cap;
    ctx.stroke(b.path);
  }
}

/** Flat [x0, y0, x1, y1, …] ring or line in BASE_ZOOM pixels relative to an origin. */
export type Flat = number[];

/** [lat, lng] ring → flat relative pixels. */
export function projectRing(ring: readonly (readonly [number, number] | L.LatLngTuple)[], ox: number, oy: number): Flat {
  const out: Flat = new Array(ring.length * 2);
  for (let i = 0; i < ring.length; i++) {
    out[2 * i] = projectX(ring[i][1]) - ox;
    out[2 * i + 1] = projectY(ring[i][0]) - oy;
  }
  return out;
}

const signedArea = (r: Flat) => {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return a;
};

const reversed = (r: Flat) => {
  const out: Flat = new Array(r.length);
  for (let i = 0, n = r.length; i < n; i += 2) {
    out[n - 2 - i] = r[i];
    out[n - 1 - i] = r[i + 1];
  }
  return out;
};

/** Outer rings one way round, holes the other, so a nonzero fill of many polygons keeps the holes. */
export const windPolygon = (rings: Flat[]): Flat[] =>
  rings.map((r, i) => ((signedArea(r) > 0) === (i === 0) ? r : reversed(r)));

export function addRing(path: Path2D, r: Flat, closed: boolean) {
  if (r.length < 4) return;
  path.moveTo(r[0], r[1]);
  for (let i = 2; i < r.length; i += 2) path.lineTo(r[i], r[i + 1]);
  if (closed) path.closePath();
}
