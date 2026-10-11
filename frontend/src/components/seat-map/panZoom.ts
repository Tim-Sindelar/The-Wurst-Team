/* Pan and zoom for the seat map.
   Mouse or one finger pans, two fingers pinch, the wheel zooms at the
   pointer. A tap that doesn't move selects the seat under it. Works on the
   DOM directly so dragging doesn't re-render React on every frame. */

const MAX_SCALE = 2.5;
/* A seat the map opened on (a QR code, a friend) is shown this close up. */
const FOCUS_SCALE = 1.75;
const FIT_MARGIN = 24;
const TAP_SLOP = 6;
const KEY_STEP = 48;
/* Glide to a selected seat: transform only, within the 150 to 250ms motion rule. */
const GLIDE_MS = 240;

type Point = { x: number; y: number };

type Gesture =
  | {
      kind: 'pan';
      origin: Point;
      x: number;
      y: number;
      seat: HTMLElement | null;
      moved: boolean;
    }
  | {
      kind: 'pinch';
      distance: number;
      scale: number;
      worldX: number;
      worldY: number;
    };

export type PanZoomOptions = {
  viewport: HTMLElement;
  world: HTMLElement;
  /** Pixels at the bottom of the viewport that something (the seat card) covers right now. */
  getCovered?: () => number;
  /** A seat was tapped without dragging. */
  onSeatTap: (seat: HTMLElement) => void;
  /** Any pointer press on the map outside the buttons (closes the colour key). */
  onMapPress: () => void;
  /** The empty map (no seat, not the buttons) was tapped without dragging. */
  onMapTap: () => void;
};

export type PanZoom = {
  fit: () => void;
  zoomBy: (factor: number) => void;
  /** Glides a seat into view; `focus` zooms in close (the seat the map opened on). */
  centerOn: (x: number, y: number, focus?: boolean) => void;
  /** Glides back inside the bounds, e.g. after the seat card closed. */
  settle: () => void;
  destroy: () => void;
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function createPanZoom({
  viewport,
  world,
  getCovered,
  onSeatTap,
  onMapPress,
  onMapTap,
}: PanZoomOptions): PanZoom {
  const pointers = new Map<number, Point>();
  const worldWidth = world.offsetWidth;
  const worldHeight = world.offsetHeight;
  let width = viewport.clientWidth;
  let height = viewport.clientHeight;
  let scale = 1;
  let x = 0;
  let y = 0;
  let fitted = false;
  let gesture: Gesture | null = null;
  let frame = 0;
  let tapping = false;

  /* The part of the map the seat card doesn't cover. */
  const visibleHeight = () => Math.max(1, height - (getCovered?.() ?? 0));

  /* Zooming out stops when the whole room fits above the seat card. */
  const minScale = () =>
    Math.min(
      (width - FIT_MARGIN) / worldWidth,
      (visibleHeight() - FIT_MARGIN) / worldHeight,
    );

  /* Keeps the room in view: centred when it is smaller than the visible
     area, otherwise no empty edge, so the room's bottom can be dragged up
     above the seat card. */
  const bound = (s: number, nx: number, ny: number) => {
    const w = worldWidth * s;
    const h = worldHeight * s;
    const visible = visibleHeight();
    return {
      x: w <= width ? (width - w) / 2 : clamp(nx, width - w, 0),
      y: h <= visible ? (visible - h) / 2 : clamp(ny, visible - h, 0),
    };
  };

  const apply = () => {
    world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const draw = () => {
    stop();
    ({ x, y } = bound(scale, x, y));
    apply();
  };

  /* Glides to a view. Any touch, wheel or key stops the glide where it is. */
  const glideTo = (nextScale: number, nextX: number, nextY: number) => {
    stop();
    const to = { scale: nextScale, ...bound(nextScale, nextX, nextY) };
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reduced) {
      ({ scale, x, y } = to);
      apply();
      return;
    }
    const from = { scale, x, y };
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / GLIDE_MS);
      const k = 1 - (1 - t) ** 3;
      scale = from.scale + (to.scale - from.scale) * k;
      x = from.x + (to.x - from.x) * k;
      y = from.y + (to.y - from.y) * k;
      apply();
      frame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    frame = requestAnimationFrame(step);
  };

  /* Selecting from the overview zooms back to at least 100% to inspect. */
  const centerOn = (wx: number, wy: number, focus = false) => {
    fitted = false;
    const next = Math.max(focus ? FOCUS_SCALE : 1, scale);
    /* Centre in the part of the map the seat card doesn't cover. */
    glideTo(next, width / 2 - wx * next, visibleHeight() / 2 - wy * next);
  };

  const settle = () => {
    if (fitted) {
      const next = minScale();
      glideTo(next, 0, 0);
    } else glideTo(scale, x, y);
  };

  const zoomTo = (
    next: number,
    anchor: Point = { x: width / 2, y: height / 2 },
  ) => {
    const old = scale;
    fitted = false;
    scale = clamp(next, minScale(), MAX_SCALE);
    x = anchor.x - ((anchor.x - x) * scale) / old;
    y = anchor.y - ((anchor.y - y) * scale) / old;
    draw();
  };

  const fit = () => {
    fitted = true;
    scale = minScale();
    draw();
  };

  const point = (event: PointerEvent | WheelEvent): Point => {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startPinch = () => {
    const [a, b] = Array.from(pointers.values());
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gesture = {
      kind: 'pinch',
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      scale,
      worldX: (mid.x - x) / scale,
      worldY: (mid.y - y) / scale,
    };
  };

  const inside = (event: Event, selector: string) =>
    event.target instanceof Element && event.target.closest(selector) !== null;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || inside(event, '[data-map-info]')) return;
    onMapPress();
    stop();
    event.preventDefault();
    const p = point(event);
    pointers.set(event.pointerId, p);
    viewport.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      const seat =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-seat-id]')
          : null;
      gesture = { kind: 'pan', origin: p, x, y, seat, moved: false };
    } else if (pointers.size === 2) startPinch();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, point(event));
    fitted = false;
    if (pointers.size >= 2 && gesture?.kind === 'pinch') {
      const [a, b] = Array.from(pointers.values());
      scale = clamp(
        (gesture.scale * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.distance,
        minScale(),
        MAX_SCALE,
      );
      x = (a.x + b.x) / 2 - gesture.worldX * scale;
      y = (a.y + b.y) / 2 - gesture.worldY * scale;
    } else if (gesture?.kind === 'pan') {
      const p = pointers.get(event.pointerId)!;
      if (Math.hypot(p.x - gesture.origin.x, p.y - gesture.origin.y) > TAP_SLOP)
        gesture.moved = true;
      x = gesture.x + p.x - gesture.origin.x;
      y = gesture.y + p.y - gesture.origin.y;
    }
    const dragging =
      gesture?.kind === 'pinch' || (gesture?.kind === 'pan' && gesture.moved);
    viewport.classList.toggle('cursor-grabbing', dragging);
    draw();
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    const tapped =
      gesture?.kind === 'pan' && !gesture.moved && event.type === 'pointerup'
        ? gesture.seat
        : null;
    const tappedEmpty =
      gesture?.kind === 'pan' &&
      !gesture.moved &&
      !gesture.seat &&
      event.type === 'pointerup';
    pointers.delete(event.pointerId);
    if (viewport.hasPointerCapture(event.pointerId))
      viewport.releasePointerCapture(event.pointerId);
    if (pointers.size >= 2) startPinch();
    else if (pointers.size === 1) {
      gesture = {
        kind: 'pan',
        origin: Array.from(pointers.values())[0],
        x,
        y,
        seat: null,
        moved: true,
      };
    } else {
      gesture = null;
      viewport.classList.remove('cursor-grabbing');
    }
    if (tapped) {
      onSeatTap(tapped);
      /* The tap itself brings the seat into view, once the card's height is known. */
      tapping = true;
      tapped.focus({ preventScroll: true });
      tapping = false;
    } else if (tappedEmpty) onMapTap();
  };

  const onWheel = (event: WheelEvent) => {
    if (inside(event, '[data-map-info]')) return;
    event.preventDefault();
    zoomTo(
      scale * Math.exp(-clamp(event.deltaY, -100, 100) * 0.003),
      point(event),
    );
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (inside(event, '[data-map-info]')) return;
    if (event.key === '+' || event.key === '=') zoomTo(scale * 1.25);
    else if (event.key === '-') zoomTo(scale * 0.8);
    else if (event.key === '0' || event.key === 'Home') fit();
    else if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      fitted = false;
      x +=
        event.key === 'ArrowLeft'
          ? KEY_STEP
          : event.key === 'ArrowRight'
            ? -KEY_STEP
            : 0;
      y +=
        event.key === 'ArrowUp'
          ? KEY_STEP
          : event.key === 'ArrowDown'
            ? -KEY_STEP
            : 0;
      draw();
    } else return;
    event.preventDefault();
  };

  /* Keyboard focus on a seat brings it into view. */
  const onFocusIn = (event: FocusEvent) => {
    const seat =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-seat-id]')
        : null;
    if (seat && !tapping)
      centerOn(Number(seat.dataset.x), Number(seat.dataset.y));
  };

  const onResize = () => {
    const oldWidth = width;
    const oldHeight = height;
    width = viewport.clientWidth;
    height = viewport.clientHeight;
    /* The observer also reports the starting size: nothing changed, so a
       glide that just started (to the seat the map opened on) keeps going. */
    if (width === oldWidth && height === oldHeight) return;
    if (fitted) {
      fit();
      return;
    }
    x += (width - oldWidth) / 2;
    y += (height - oldHeight) / 2;
    scale = Math.max(scale, minScale());
    draw();
  };

  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerEnd);
  viewport.addEventListener('pointercancel', onPointerEnd);
  viewport.addEventListener('lostpointercapture', onPointerEnd);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('keydown', onKeyDown);
  viewport.addEventListener('focusin', onFocusIn);
  const observer = new ResizeObserver(onResize);
  observer.observe(viewport);

  fit();

  return {
    fit,
    zoomBy: (factor) => zoomTo(scale * factor),
    centerOn,
    settle,
    destroy: () => {
      stop();
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerEnd);
      viewport.removeEventListener('pointercancel', onPointerEnd);
      viewport.removeEventListener('lostpointercapture', onPointerEnd);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('keydown', onKeyDown);
      viewport.removeEventListener('focusin', onFocusIn);
      observer.disconnect();
    },
  };
}
