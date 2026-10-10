/**
 * Probabilistic fingerprinting on the PolyMaps radio map.
 *
 * Each radio map point stores, per beacon, how likely a scan hears it and its mean RSSI when heard
 * (decoded from the raw statistics, see decodeStatistic). For a scan (mean RSSI per heard beacon over
 * a short window) the log-likelihood of a point is
 *   sum over heard beacons in its fingerprint      log P(heard) + log N(rssi + offset; heard mean, σ)
 * + sum over heard beacons not in its fingerprint  log P(heard anyway) + log N(rssi + offset; weak, σ)
 * + sum over its beacons that were not heard       log P(not heard)
 * The position is the likelihood-weighted mean of the best K points on the most likely level.
 * `offset` absorbs the difference between this phone's radio and the device the map was made with.
 */
import { fromLocal, toLocal } from '../geo';
import { HEARD_STD, type RadioMap, type Tile } from './radioMap';

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
  /** Scanner noise and model error added to the heard spread, in dB. */
  noiseStd: number;
  /** Heard beacons the point's fingerprint doesn't contain: how likely, and at what RSSI. */
  unknownDetect: number;
  unknownMean: number;
  unknownStd: number;
  /** Scans per window: a beacon heard in any of them counts as heard. */
  scansPerWindow: number;
  /** Restrict to these levels (indices), e.g. from a tracker's floor belief. */
  levels?: Set<number>;
}

export const DEFAULT_LOCATE: LocateOptions = {
  offset: 0,
  k: 10,
  radius: 45,
  noiseStd: 3,
  unknownDetect: 0.03,
  unknownMean: -95,
  unknownStd: 6,
  scansPerWindow: 2,
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

const ANCHOR_SPREAD_M = 150;

/**
 * The strongest heard beacons with a known position that agree on where we are: the largest group
 * within ANCHOR_SPREAD_M of one of them. A few beacon ids occur in two buildings (32 of ~12 400
 * are heard strongly more than 300 m apart), so a single beacon's rough position can't be trusted.
 */
export function anchorBeacons(map: RadioMap, obs: Observation[], count = 6): { beacon: number; lng: number; lat: number }[] {
  const strongest = [...obs]
    .sort((a, b) => b.rssi - a.rssi)
    .map((o) => ({ beacon: o.beacon, p: map.beaconPosition(o.beacon) }))
    .filter((a): a is { beacon: number; p: NonNullable<typeof a.p> } => a.p !== null)
    .slice(0, count);
  let best: typeof strongest = [];
  for (const centre of strongest) {
    const group = strongest.filter((a) => {
      const d = toLocal(a.p, centre.p);
      return Math.hypot(d.x, d.y) < ANCHOR_SPREAD_M;
    });
    if (group.length > best.length) best = group; // ties: the earlier (stronger) centre wins
  }
  return best.slice(0, 4).map((a) => ({ beacon: a.beacon, lng: a.p.lng, lat: a.p.lat }));
}

/** Tiles that can contain the scanner: around the anchor beacons. */
export function candidateTiles(map: RadioMap, obs: Observation[], radius = DEFAULT_LOCATE.radius): string[] {
  const keys = new Set<string>();
  for (const a of anchorBeacons(map, obs)) for (const key of map.tilesAround(a, radius)) keys.add(key);
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
  // Every point pays the "not in its fingerprint" price for all heard beacons; matched ones refund it.
  let unknownTotal = 0;
  const unknownOf = new Map<number, number>();
  for (const [b, rssi] of observed) {
    const u = Math.log(opt.unknownDetect) + logNormal(rssi, opt.unknownMean, opt.unknownStd);
    unknownOf.set(b, u);
    unknownTotal += u;
  }
  const std = Math.hypot(HEARD_STD, opt.noiseStd);

  const anchors = anchorBeacons(map, obs);
  const scored: Scored[] = [];
  const seen = new Set<string>();
  for (const key of candidateTiles(map, obs, opt.radius)) {
    const tile = map.getTile(key);
    if (!tile) continue;
    for (const o of anchors) {
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
        let ll = unknownTotal;
        for (let e = tile.offsets[i]; e < tile.offsets[i + 1]; e++) {
          const b = tile.beacon[e];
          const missed = Math.pow(1 - tile.detect[e], opt.scansPerWindow);
          const rssi = observed.get(b);
          if (rssi !== undefined) {
            ll += Math.log(1 - missed) + logNormal(rssi, tile.heardMean[e], std) - unknownOf.get(b)!;
          } else {
            ll += Math.log(missed);
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
