/**
 * Debug view of the last visual fixes (see debug.ts): the frame SuperPoint saw with its keypoints,
 * matches and inliers, and why a fix failed.
 */
import { useEffect, useRef, useState } from 'react';
import type { DebugFrame, VpsResult } from './client';
import { drawDebug, type FeatureStats, type ImageStats } from './debug';

export interface VpsDebugAttempt {
  id: string;
  time: number;
  frame?: DebugFrame;
  result: VpsResult | null;
  error: string | null;
  image?: ImageStats;
  features?: FeatureStats;
  /** Rendered camera at capture: heading (deg from north), pitch, recent angular speed (deg/s). */
  rendered: { heading: number; pitch: number; angularSpeed: number | null };
  upload: string;
}

/** Likely causes, from the numbers (thresholds from looking at failing frames, rough). */
export function hints(a: VpsDebugAttempt): string[] {
  const h: string[] = [];
  const r = a.result, d = r?.debug;
  if (a.image && a.image.mean < 45) h.push('dark image');
  if (a.image && a.image.sharpness < 60) h.push('blurred (motion or focus)');
  if (a.rendered.angularSpeed != null && a.rendered.angularSpeed > 40) h.push(`phone turning (${a.rendered.angularSpeed.toFixed(0)}°/s)`);
  if (a.features && a.features.n < 300) h.push(`few keypoints (${a.features.n}): blank walls?`);
  if (a.features && a.features.coverage < 0.35) h.push('keypoints in a small part of the image');
  if (d && d.candidates && d.candidates.length === 0) h.push('no map images near the beacon fix: wrong position or level?');
  if (d?.shortlist?.length && !d.shortlist.some((s) => s.used)) h.push(`best map image has only ${d.shortlist[0].mnn} similar features: place not in the map, or changed?`);
  if (d?.pose?.priorDist != null && d.pose.priorDist > 8) h.push(`pose ${d.pose.priorDist.toFixed(1)} m from the beacon fix`);
  if (d?.reprojError && d.reprojError.median > 4) h.push('large reprojection error: unstable pose');
  if (d?.inlierDepth && d.inlierDepth.median > 25) h.push('only far points matched: position along the view is weak');
  return h;
}

const f0 = (v: number | undefined | null) => (v == null ? '–' : v.toFixed(0));
const f1 = (v: number | undefined | null) => (v == null ? '–' : v.toFixed(1));

export function VpsDebugPanel({ attempts }: { attempts: VpsDebugAttempt[] }) {
  const [index, setIndex] = useState(0); // 0: newest
  const [open, setOpen] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const a = attempts[Math.min(index, attempts.length - 1)];
  useEffect(() => setIndex(0), [attempts.length]);
  useEffect(() => {
    if (open && a?.frame && canvasRef.current) drawDebug(canvasRef.current, a.frame, a.result);
  }, [a, open]);
  if (!a) return <div className="vps-debug"><div className="vps-debug-head">Debug: no visual fix yet</div></div>;

  const r = a.result, d = r?.debug;
  const dHeading = r?.ok && r.heading != null ? ((r.heading - a.rendered.heading + 540) % 360) - 180 : null;
  const timing = d?.timing ? Object.entries(d.timing).map(([k, v]) => `${k} ${v}`).join(', ') : '';
  const rows: [string, string][] = [
    ['result', a.error ? `error: ${a.error}` : r?.ok ? `fix, ${r.inliers} inliers / ${r.matches} matches` : `${r?.reason ?? '?'}${r?.inliers != null ? ` (${r.inliers} inliers)` : ''}`],
    ['heading', r?.ok ? `visual ${f0(r.heading)}°, AR ${f0(a.rendered.heading)}° → ${dHeading! >= 0 ? '+' : ''}${f1(dHeading)}°` : `AR ${f0(a.rendered.heading)}°${d?.pose ? `, rejected pose ${f0(d.pose.heading)}°` : ''}`],
    ['pose', d?.pose ? `${f1(d.pose.priorDist)} m from beacon fix, ${d.pose.levelId?.replace('ETH.', '')}, camera ${f1(d.pose.height)} m, pitch ${f0(d.pose.pitch)}° (AR ${f0(a.rendered.pitch)}°)` : '–'],
    ['solver', d?.solvers ? `${Object.entries(d.solvers).map(([k, s]) => `${k}: ${s ? `${s.inliers} inl, fov ${f0(s.fov)}°` : 'failed'}`).join(' · ')} → ${d.solver ?? '–'}; reproj ${f1(d.reprojError?.median)} / ${f1(d.reprojError?.p90)} px; depth ${f1(d.inlierDepth?.median)} m` : '–'],
    ['focal', a.frame ? `guess ${f0(a.frame.focal)} px${d?.pose ? `, refined ${f0(d.pose.focal)} px` : ''}` : '–'],
    ['map', d ? `${d.candidates?.length ?? 0} images near the fix (r ${f0(d.prior?.radius)} m, ${d.prior?.levelId?.replace('ETH.', '') ?? 'any level'}); shortlist mnn/lg/3d: ${(d.shortlist ?? []).map((s) => `${s.mnn}${s.used ? `/${s.matches}/${s.matches3d}` : '✗'}`).join(' ') || '–'}` : '–'],
    ['features', a.features ? `${a.features.n} kp, coverage ${Math.round(100 * a.features.coverage)} %, score median ${a.features.scoreMedian}` : '–'],
    ['image', a.image ? `${a.frame?.width}×${a.frame?.height}, brightness ${a.image.mean}, sharpness ${a.image.sharpness}, dark ${Math.round(100 * a.image.dark)} %, white ${Math.round(100 * a.image.saturated)} %, turning ${f0(a.rendered.angularSpeed)}°/s` : '–'],
    ['time', r ? `${f1(r.totalMs / 1000)} s: features ${f1(r.extractMs / 1000)} s (${r.backend}), server ${r.ms ?? '–'} ms (${timing}), ${Math.round(r.bytes / 1024)} KiB` : '–'],
    ['server', `${a.id} · ${a.upload}`],
  ];
  const h = hints(a);
  return (
    <div className="vps-debug">
      <div className="vps-debug-head">
        <button onClick={() => setIndex((i) => Math.min(i + 1, attempts.length - 1))} disabled={index >= attempts.length - 1}>‹</button>
        <span>Debug {attempts.length - index}/{attempts.length} · {new Date(a.time).toLocaleTimeString()}</span>
        <button onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0}>›</button>
        <button onClick={() => setOpen((o) => !o)}>{open ? 'hide' : 'show'}</button>
      </div>
      {open && (
        <>
          {a.frame ? <canvas ref={canvasRef} className="vps-debug-canvas" /> : <div>no frame</div>}
          <div className="vps-debug-legend">
            <span style={{ color: '#ffe600' }}>■ keypoint</span> <span style={{ color: '#ff8c00' }}>○ matched to map</span>{' '}
            <span style={{ color: '#00e650' }}>● inlier</span> <span style={{ color: '#3c8cff' }}>— to reprojection</span>
          </div>
          {h.length > 0 && <div className="vps-debug-hints">{h.join(' · ')}</div>}
          <table>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}><th>{k}</th><td>{v}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
