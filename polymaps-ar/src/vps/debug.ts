/**
 * Debug mode of the visual fix (the "debug" switch in the AR view, or ?vpsDebug=1).
 *
 * On the phone: each attempt's grey frame exactly as SuperPoint saw it, with its keypoints, the ones
 * the server matched to the 3D map and the pose's inliers (plus where the pose puts their 3D
 * points), and the numbers behind it (VpsDebugPanel.tsx).
 *
 * On the server: the query is stored under a debug id (vps/vps/debugstore.py) and the phone uploads
 * the frame (PNG, lossless: the server re-runs the reference SuperPoint on it) and its context
 * (orientation at capture, camera, timings, image quality, see ArView). vps/debug_replay.py replays
 * and draws them. Unlike normal use, the image leaves the phone here.
 */
import type { DebugFrame, VpsResult } from './client';

const STORAGE_KEY = 'polymaps.vpsDebug';

export function debugInitiallyOn(): boolean {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('vpsDebug') === '1') return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberDebug(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // private mode: not remembered
  }
}

/** Sortable and unique enough: 2026-10-10T12-30-05-123Z_k3j9x */
export function newDebugId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface ImageStats {
  /** Mean brightness, 0..255. */
  mean: number;
  /** Variance of the Laplacian (0..255 scale): low means blurred (motion, focus). */
  sharpness: number;
  /** Fractions of nearly black / nearly white pixels. */
  dark: number;
  saturated: number;
}

export function imageStats(gray: Float32Array, w: number, h: number): ImageStats {
  let sum = 0, dark = 0, sat = 0;
  for (const v of gray) {
    sum += v;
    if (v < 0.06) dark++;
    else if (v > 0.98) sat++;
  }
  let ls = 0, ls2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 255 * (gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i]);
      ls += l;
      ls2 += l * l;
      n++;
    }
  }
  const lm = ls / Math.max(n, 1);
  return {
    mean: Math.round((255 * sum) / gray.length),
    sharpness: Math.round(ls2 / Math.max(n, 1) - lm * lm),
    dark: round3(dark / gray.length),
    saturated: round3(sat / gray.length),
  };
}

export interface FeatureStats {
  n: number;
  scoreMedian: number;
  /** Share of the image's 8 x 6 grid cells with at least one keypoint: low = features in one corner. */
  coverage: number;
}

export function featureStats(f: DebugFrame['features']): FeatureStats {
  const n = f.scores.length;
  const sorted = Array.from(f.scores).sort((a, b) => a - b);
  const cells = new Set<number>();
  for (let i = 0; i < n; i++) {
    const cx = Math.min(7, Math.floor((f.keypoints[2 * i] / f.width) * 8));
    const cy = Math.min(5, Math.floor((f.keypoints[2 * i + 1] / f.height) * 6));
    cells.add(cy * 8 + cx);
  }
  return { n, scoreMedian: round3(sorted[n >> 1] ?? 0), coverage: round3(cells.size / 48) };
}

function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}

function grayCanvas(frame: DebugFrame): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = frame.width;
  c.height = frame.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(frame.width, frame.height);
  for (let i = 0; i < frame.gray.length; i++) {
    // The same rounding as the bytes NativeSuperPoint gets.
    const v = Math.round(frame.gray[i] * 255);
    img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
    img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function framePng(frame: DebugFrame): Promise<Blob> {
  return new Promise((resolve, reject) => grayCanvas(frame).toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

/** Frame and context to the server, for the query it stored under `id`. Resolves to a status text. */
export async function uploadDebug(id: string, frame: DebugFrame, context: unknown, base = 'vps/debug'): Promise<string> {
  const put = async (name: string, body: Blob | string, type: string) => {
    const r = await fetch(`${base}/${id}/${name}`, { method: 'PUT', headers: { 'Content-Type': type }, body });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  };
  const png = await framePng(frame);
  await put('client.json', JSON.stringify(context), 'application/json');
  await put('frame.png', png, 'image/png');
  return `uploaded (${Math.round(png.size / 1024)} KiB frame)`;
}

/**
 * The frame with grey keypoints, matched ones (2D-3D) as orange rings, inliers green with a blue
 * line to where the pose projects their 3D point (long lines: a bad pose or wrong matches).
 */
export function drawDebug(canvas: HTMLCanvasElement, frame: DebugFrame, res: VpsResult | null) {
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(grayCanvas(frame), 0, 0);
  const kp = frame.features.keypoints;
  const dbg = res?.debug;
  ctx.fillStyle = 'rgba(255, 230, 0, 0.8)';
  for (let i = 0; i < kp.length; i += 2) ctx.fillRect(kp[i] - 1, kp[i + 1] - 1, 2, 2);
  ctx.strokeStyle = 'rgb(255, 140, 0)';
  ctx.lineWidth = 1;
  for (const k of dbg?.matchedKp ?? []) {
    ctx.beginPath();
    ctx.arc(kp[2 * k], kp[2 * k + 1], 3.5, 0, 2 * Math.PI);
    ctx.stroke();
  }
  const inl = dbg?.inlierKp ?? [];
  const rep = dbg?.reprojected ?? [];
  ctx.strokeStyle = 'rgb(60, 140, 255)';
  ctx.beginPath();
  inl.forEach((k, j) => {
    if (!rep[j]) return;
    ctx.moveTo(kp[2 * k], kp[2 * k + 1]);
    ctx.lineTo(rep[j][0], rep[j][1]);
  });
  ctx.stroke();
  ctx.fillStyle = 'rgb(0, 230, 80)';
  for (const k of inl) {
    ctx.beginPath();
    ctx.arc(kp[2 * k], kp[2 * k + 1], 2.5, 0, 2 * Math.PI);
    ctx.fill();
  }
}
