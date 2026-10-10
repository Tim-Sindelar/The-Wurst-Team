/**
 * 2D floor plan of one level with the live fixes. Drag to pan, wheel / pinch to zoom, tap to pick
 * a position (ground truth for the accuracy test, or where the simulated phone is).
 */
import { useEffect, useRef, useState } from 'react';
import { fromLocal, toLocal, type LngLat } from '../geo';
import { KIND_COLORS, type FloorPlans, type LevelPlan } from '../floors/floorPlans';
import type { PositionFix } from '../positioning/types';

export interface MapMarker extends LngLat {
  kind: 'truth' | 'checkpoint';
  label?: string;
}

interface Props {
  floors: FloorPlans;
  levelId: string;
  fixes: PositionFix[];
  markers: MapMarker[];
  /** Fit the view on this point when it changes (e.g. the first fix). */
  focus: LngLat | null;
  onPick?: (p: LngLat) => void;
}

const METHOD_COLORS: Record<string, string> = { ble: '#1f6feb', gps: '#e8590c' };

export function MapCanvas({ floors, levelId, fixes, markers, focus, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [plan, setPlan] = useState<LevelPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  // View: origin of the plan's local frame, centre (m) and scale (px per m).
  const summary = floors.level(levelId);
  const origin = useRef<LngLat>({ lng: 8.5476, lat: 47.3763 });
  const view = useRef({ cx: 0, cy: 0, scale: 4 });
  const [, redraw] = useState(0);

  useEffect(() => {
    if (!summary) return;
    const [x0, y0, x1, y1] = summary.bbox;
    const o = { lng: (x0 + x1) / 2, lat: (y0 + y1) / 2 };
    let cancelled = false;
    setError(null);
    floors
      .plan(levelId, o)
      .then((p) => {
        if (cancelled) return;
        // Keep the view where it was when switching floors of the same building.
        const prev = origin.current;
        const shift = toLocal(prev, o);
        origin.current = o;
        view.current.cx += shift.x;
        view.current.cy += shift.y;
        setPlan(p);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [floors, levelId, summary]);

  // Fit on a new focus point, or on the level when there is none.
  const fitted = useRef<string>('');
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !summary) return;
    const key = focus ? `${focus.lng.toFixed(5)},${focus.lat.toFixed(5)}` : `level:${summary.facilityId}`;
    if (fitted.current === key) return;
    fitted.current = key;
    if (focus) {
      const p = toLocal(focus, origin.current);
      view.current = { cx: p.x, cy: p.y, scale: Math.max(view.current.scale, 5) };
    } else {
      const [x0, y0, x1, y1] = summary.bbox;
      const a = toLocal({ lng: x0, lat: y0 }, origin.current);
      const b = toLocal({ lng: x1, lat: y1 }, origin.current);
      const w = canvas.clientWidth || 400, h = canvas.clientHeight || 400;
      view.current = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, scale: 0.9 * Math.min(w / (b.x - a.x), h / (b.y - a.y)) };
    }
    redraw((n) => n + 1);
  }, [focus, summary, plan]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--map-bg') || '#f6f5f1';
    ctx.fillRect(0, 0, w, h);
    const { cx, cy, scale } = view.current;
    const X = (x: number) => w / 2 + (x - cx) * scale;
    const Y = (y: number) => h / 2 - (y - cy) * scale;
    const ring = (r: Float32Array) => {
      ctx.moveTo(X(r[0]), Y(r[1]));
      for (let i = 2; i < r.length; i += 2) ctx.lineTo(X(r[i]), Y(r[i + 1]));
      ctx.closePath();
    };
    if (plan) {
      for (const room of plan.rooms) {
        ctx.beginPath();
        for (const poly of room.polygons) for (const r of poly) ring(r);
        ctx.fillStyle = KIND_COLORS[room.kind] ?? KIND_COLORS.other;
        ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      const lines = (ls: Float32Array[], color: string, width: number) => {
        ctx.beginPath();
        for (const l of ls) {
          ctx.moveTo(X(l[0]), Y(l[1]));
          for (let i = 2; i < l.length; i += 2) ctx.lineTo(X(l[i]), Y(l[i + 1]));
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      };
      if (scale > 2) lines(plan.walls, '#555', Math.min(2, scale / 6));
      if (scale > 4) lines(plan.doors, '#2f9e44', 1);
      if (scale > 3) lines(plan.stairs, '#b08800', 1);
      if (scale > 5) {
        ctx.fillStyle = '#333';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        for (const room of plan.rooms) {
          if (room.area * scale * scale < 2500 || !room.name || room.kind === 'circulation') continue;
          ctx.fillText(room.name.split(' ').slice(1).join(' '), X(room.centroid.x), Y(room.centroid.y));
        }
      }
    }
    for (const m of markers) {
      const p = toLocal(m, origin.current);
      const x = X(p.x), y = Y(p.y);
      ctx.strokeStyle = m.kind === 'truth' ? '#2b8a3e' : '#495057';
      ctx.lineWidth = m.kind === 'truth' ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 8);
      ctx.lineTo(x + 8, y + 8);
      ctx.moveTo(x + 8, y - 8);
      ctx.lineTo(x - 8, y + 8);
      ctx.stroke();
      if (m.label) {
        ctx.fillStyle = '#212529';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(m.label, x + 10, y - 8);
      }
    }
    for (const f of fixes) {
      const p = toLocal(f, origin.current);
      const x = X(p.x), y = Y(p.y);
      const color = METHOD_COLORS[f.method] ?? '#000';
      const dim = f.levelId !== null && f.levelId !== levelId;
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(4, f.accuracy * scale), 0, 2 * Math.PI);
      ctx.fillStyle = color + '22';
      ctx.fill();
      ctx.strokeStyle = color + '88';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Scale bar
    const meters = [1, 2, 5, 10, 20, 50, 100, 200].find((m) => m * scale > 60) ?? 500;
    ctx.fillStyle = '#212529';
    ctx.fillRect(12, h - 18, meters * scale, 3);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${meters} m`, 12, h - 24);
  });

  // Pan / zoom / pick.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const pinch = useRef<number | null>(null);
  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { cx, cy, scale } = view.current;
    return { x: cx + (clientX - rect.left - rect.width / 2) / scale, y: cy - (clientY - rect.top - rect.height / 2) / scale };
  };
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const before = toWorld(clientX, clientY);
    view.current.scale = Math.max(0.2, Math.min(80, view.current.scale * factor));
    const after = toWorld(clientX, clientY);
    view.current.cx += before.x - after.x;
    view.current.cy += before.y - after.y;
    redraw((n) => n + 1);
  };

  return (
    <div className="map-wrap">
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onWheel={(e) => zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY / 400))}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          moved.current = 0;
          pinch.current = null;
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          if (!prev) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch.current) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.current);
            pinch.current = d;
            moved.current += 10;
            return;
          }
          const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
          moved.current += Math.abs(dx) + Math.abs(dy);
          view.current.cx -= dx / view.current.scale;
          view.current.cy += dy / view.current.scale;
          redraw((n) => n + 1);
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (moved.current < 6 && onPick && pointers.current.size === 0) {
            const p = toWorld(e.clientX, e.clientY);
            onPick(fromLocal(p.x, p.y, origin.current));
          }
        }}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
      />
      {error && <div className="map-error">{error}</div>}
    </div>
  );
}
