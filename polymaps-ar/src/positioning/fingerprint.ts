/**
 * Probabilistic fingerprinting on the PolyMaps radio map.
 *
 * Each radio map point stores, per beacon, the mean and standard deviation of the RSSI measured
 * there. For a scan (mean RSSI per heard beacon over a short window) the log-likelihood of a point is
 *   sum over heard beacons in its fingerprint   log N(rssi + offset; mean, std)
 * + sum over heard beacons not in its fingerprint log N(rssi + offset; MISSING_MEAN, MISSING_STD)
 * + sum over strong beacons it expects but that were not heard  log P(rssi < detection threshold)
 * The position is the likelihood-weighted mean of the best K points on the most likely level.
 * `offset` absorbs the difference between this phone's radio and the device the map was made with.
 */
import { fromLocal, toLocal } from '../geo';
import type { RadioMap, Tile } from './radioMap';

export interface Observation {
  beacon: number;
  rssi: number;
}

export interface LocateOptions {
  /** dB added to every observed RSSI (device calibration). */
  offset: number;
  /** Number of best points averaged. */
  k: number;
  /** Search radius (m) around the strongest beacons' rough positions. */
  radius: number;
  /** Lower bound on the radio map std, plus the scanner's own noise, in dB. */
  noiseStd: number;
  /** RSSI assumed for heard beacons the point's fingerprint doesn't contain. */
  missingMean: number;
  missingStd: number;
  /** Phones rarely report weaker beacons; expected beacons below this don't count as missing. */
  detectionThreshold: number;
  /** Restrict to these levels (indices), e.g. from a tracker's floor belief. */
  levels?: Set<number>;
}

export const DEFAULT_LOCATE: LocateOptions = {
  offset: 0,
  k: 10,
  radius: 45,
  noiseStd: 3,
  missingMean: -100,
  missingStd: 5,
  detectionThreshold: -98,
};

export interface Estimate {
  lng: number;
  lat: number;
  levelIndex: number;
  levelId: string;
  /** 1-sigma radius in metres. */
  accuracy: number;
  /** Share of the K best points' weight on the chosen level. */
  levelConfidence: number;
  logLikelihood: number;
  candidates: number;
  beacons: number;
}

const LOG_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

function logNormal(x: number, mean: number, std: number): number {
  const z = (x - mean) / std;
  return -0.5 * z * z - Math.log(std) - LOG_SQRT_2PI;
}

/** log of the standard normal CDF, stable for very negative z. */
function logPhi(z: number): number {
  if (z > -5) {
    // Abramowitz-Stegun 7.1.26 via erfc
    const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
    const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    const erfc = y * Math.exp(-(z * z) / 2);
    return Math.log(z >= 0 ? 1 - erfc / 2 : erfc / 2);
  }
  return -0.5 * z * z - Math.log(-z) - LOG_SQRT_2PI;
}

/** Tiles that can contain the scanner: around the rough positions of the strongest beacons heard. */
export function candidateTiles(map: RadioMap, obs: Observation[], radius = DEFAULT_LOCATE.radius): string[] {
  const keys = new Set<string>();
  const strongest = [...obs].sort((a, b) => b.rssi - a.rssi).slice(0, 4);
  for (const o of strongest) {
    const p = map.beaconPosition(o.beacon);
    if (p) for (const key of map.tilesAround(p, radius)) keys.add(key);
  }
  return [...keys];
}

interface Scored {
  tile: Tile;
  i: number;
  ll: number;
}

/** Locate from a scan. Only tiles already loaded are searched (see candidateTiles / ensureTiles). */
export function locate(map: RadioMap, observations: Observation[], options: Partial<LocateOptions> = {}): Estimate | null {
  const opt = { ...DEFAULT_LOCATE, ...options };
  const obs = observations.filter((o) => map.beaconPosition(o.beacon));
  if (obs.length === 0) return null;

  const observed = new Map<number, number>();
  for (const o of obs) observed.set(o.beacon, o.rssi + opt.offset);
  // Every point pays the "not in fingerprint" price for all heard beacons; matched beacons refund it.
  let missingTotal = 0;
  const missingOf = new Map<number, number>();
  for (const [b, rssi] of observed) {
    const m = logNormal(rssi, opt.missingMean, opt.missingStd);
    missingOf.set(b, m);
    missingTotal += m;
  }

  const strongest = [...obs].sort((a, b) => b.rssi - a.rssi).slice(0, 4);
  const anchors = strongest.map((o) => map.beaconPosition(o.beacon)!).filter(Boolean);
  const scored: Scored[] = [];
  const seen = new Set<string>();
  for (const key of candidateTiles(map, obs, opt.radius)) {
    const tile = map.getTile(key);
    if (!tile) continue;
    for (const o of strongest) {
      for (const i of tile.byBeacon.get(o.beacon) ?? []) {
        const id = `${key}:${i}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (opt.levels && !opt.levels.has(tile.level[i])) continue;
        // Skip points far from every strong beacon (another building heard through a window).
        const near = anchors.some((a) => {
          const d = toLocal({ lng: tile.lng[i], lat: tile.lat[i] }, a);
          return d.x * d.x + d.y * d.y < opt.radius * opt.radius;
        });
        if (!near) continue;
        let ll = missingTotal;
        for (let e = tile.offsets[i]; e < tile.offsets[i + 1]; e++) {
          const b = tile.beacon[e];
          const mean = tile.mean[e];
          const std = Math.hypot(tile.std[e], opt.noiseStd);
          const rssi = observed.get(b);
          if (rssi !== undefined) {
            ll += logNormal(rssi, mean, std) - missingOf.get(b)!;
          } else if (mean > opt.detectionThreshold) {
            ll += logPhi((opt.detectionThreshold - mean) / std);
          }
        }
        scored.push({ tile, i, ll });
      }
    }
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.ll - a.ll);
  const top = scored.slice(0, Math.max(opt.k * 3, 30));
  const best = top[0].ll;
  const weights = top.map((s) => Math.exp(s.ll - best));

  // Level: weight mass per level among the best points.
  const mass = new Map<number, number>();
  let total = 0;
  top.forEach((s, j) => {
    const lv = s.tile.level[s.i];
    mass.set(lv, (mass.get(lv) ?? 0) + weights[j]);
    total += weights[j];
  });
  const [levelIndex, levelMass] = [...mass.entries()].sort((a, b) => b[1] - a[1])[0];

  const origin = { lng: top[0].tile.lng[top[0].i], lat: top[0].tile.lat[top[0].i] };
  let sw = 0, sx = 0, sy = 0, n = 0;
  const pts: { x: number; y: number; w: number }[] = [];
  for (let j = 0; j < top.length && n < opt.k; j++) {
    const s = top[j];
    if (s.tile.level[s.i] !== levelIndex) continue;
    const { x, y } = toLocal({ lng: s.tile.lng[s.i], lat: s.tile.lat[s.i] }, origin);
    pts.push({ x, y, w: weights[j] });
    sw += weights[j];
    sx += weights[j] * x;
    sy += weights[j] * y;
    n++;
  }
  const mx = sx / sw, my = sy / sw;
  let spread = 0;
  for (const p of pts) spread += p.w * ((p.x - mx) ** 2 + (p.y - my) ** 2);
  const pos = fromLocal(mx, my, origin);
  return {
    ...pos,
    levelIndex,
    levelId: map.levelId(levelIndex),
    // Spread of the best points plus a floor for the model's own error (grid, interpolation).
    accuracy: Math.hypot(Math.sqrt(spread / sw), 2),
    levelConfidence: levelMass / total,
    logLikelihood: best,
    candidates: scored.length,
    beacons: obs.length,
  };
}

/**
 * Device RSSI offset that best explains a scan: the offset with the highest best-point likelihood.
 * One scan is noisy; callers should smooth the result over time.
 */
export function estimateOffset(map: RadioMap, obs: Observation[], options: Partial<LocateOptions> = {}, range = 15, step = 3): number {
  let bestOffset = 0;
  let bestLl = -Infinity;
  for (let offset = -range; offset <= range; offset += step) {
    const est = locate(map, obs, { ...options, offset, k: 1 });
    if (est && est.logLikelihood > bestLl) {
      bestLl = est.logLikelihood;
      bestOffset = offset;
    }
  }
  return bestOffset;
}
