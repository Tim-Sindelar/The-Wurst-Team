/** Cumulative error distribution per method: the share of fixes within x metres of the truth. */
import { useState } from 'react';
import type { MethodStats } from '../evaluation/metrics';

const COLORS: Record<string, string> = { ble: '#1f6feb', gps: '#e8590c' };
const LABELS: Record<string, string> = { ble: 'BLE (PolyMaps beacons)', gps: 'GPS' };

export function ErrorCdf({ stats }: { stats: MethodStats[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = stats.filter((s) => s.errors.length > 0);
  if (shown.length === 0) return null;
  const W = 340, H = 180, L = 36, R = 12, T = 12, B = 28;
  const maxErr = Math.max(5, ...shown.map((s) => s.p95));
  const niceMax = [5, 10, 20, 30, 50, 100, 200, 500].find((v) => v >= maxErr) ?? Math.ceil(maxErr);
  const x = (m: number) => L + (Math.min(m, niceMax) / niceMax) * (W - L - R);
  const y = (p: number) => T + (1 - p) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const share = (s: MethodStats, m: number) => s.errors.filter((e) => e <= m).length / s.errors.length;

  return (
    <figure className="cdf">
      <figcaption>Share of fixes within a given error</figcaption>
      <div className="legend">
        {shown.map((s) => (
          <span key={s.method}>
            <i style={{ background: COLORS[s.method] ?? '#666' }} /> {LABELS[s.method] ?? s.method}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Cumulative error distribution"
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(px < L || px > W - R ? null : ((px - L) / (W - L - R)) * niceMax);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((p) => (
          <g key={p}>
            <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} className="grid" />
            <text x={L - 6} y={y(p) + 4} textAnchor="end" className="tick">{p * 100}%</text>
          </g>
        ))}
        {ticks.map((m) => (
          <text key={m} x={x(m)} y={H - 10} textAnchor="middle" className="tick">{m} m</text>
        ))}
        {shown.map((s) => {
          const pts = s.errors.map((e, i) => `${x(e).toFixed(1)},${y((i + 1) / s.errors.length).toFixed(1)}`);
          const d = `M${x(0)},${y(0)} L${x(s.errors[0])},${y(0)} ` + s.errors.map((e, i) => `L${x(e).toFixed(1)},${y(i / s.errors.length).toFixed(1)} L${pts[i]}`).join(' ');
          return <path key={s.method} d={d} fill="none" stroke={COLORS[s.method] ?? '#666'} strokeWidth={2} strokeLinejoin="round" />;
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="crosshair" />
            {shown.map((s) => (
              <circle key={s.method} cx={x(hover)} cy={y(share(s, hover))} r={4} fill={COLORS[s.method] ?? '#666'} stroke="#fff" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="cdf-tip">
          within {hover.toFixed(1)} m:{' '}
          {shown.map((s) => `${LABELS[s.method] ?? s.method} ${Math.round(share(s, hover) * 100)} %`).join(' · ')}
        </div>
      )}
    </figure>
  );
}
