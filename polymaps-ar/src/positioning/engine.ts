/**
 * BLE positioning pipeline: beacon readings -> sliding-window scan -> device offset calibration ->
 * fingerprint estimate -> track. Emits a PositionFix about once per second.
 */
import { candidateTiles, estimateOffset, locate, type Estimate, type LocateOptions, type Observation } from './fingerprint';
import type { RadioMap } from './radioMap';
import { Tracker, type TrackerOptions } from './tracker';
import type { BeaconReading, BeaconSource, FixSource, PositionFix } from './types';

export interface EngineOptions {
  /** Readings older than this are dropped from the scan (ms). */
  windowMs: number;
  /** How often a fix is computed (ms). */
  intervalMs: number;
  /** Fixed device offset in dB; null estimates it continuously. */
  offset: number | null;
  /** Smoothing of the estimated offset (0..1, weight of the newest estimate). */
  offsetAlpha: number;
  locate: Partial<LocateOptions>;
  tracker: Partial<TrackerOptions>;
  /** Emit raw single-scan estimates instead of the tracked position (for evaluation). */
  raw: boolean;
}

export const DEFAULT_ENGINE: EngineOptions = {
  windowMs: 2500,
  intervalMs: 1000,
  offset: null,
  offsetAlpha: 0.2,
  locate: {},
  tracker: {},
  raw: false,
};

/** Mean RSSI per beacon over the window, in the radio map's beacon indices. */
export function aggregate(map: RadioMap, readings: BeaconReading[], now: number, windowMs: number): Observation[] {
  const sums = new Map<number, { sum: number; n: number }>();
  for (const r of readings) {
    if (now - r.timestamp > windowMs || r.rssi >= 0 || r.rssi < -110) continue;
    const b = map.beaconIndex(r.uuid, r.major, r.minor);
    if (b === undefined) continue;
    const s = sums.get(b) ?? { sum: 0, n: 0 };
    s.sum += r.rssi;
    s.n++;
    sums.set(b, s);
  }
  return [...sums.entries()].map(([beacon, { sum, n }]) => ({ beacon, rssi: sum / n }));
}

export class BlePositioningEngine implements FixSource {
  readonly name: string;
  readonly map: RadioMap;
  private readonly source: BeaconSource;
  private readonly opt: EngineOptions;
  private readonly tracker: Tracker;
  private readings: BeaconReading[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private offset: number;
  private offsetSamples = 0;
  /** Latest single-scan estimate and scan, for diagnostics. */
  lastEstimate: Estimate | null = null;
  lastObservations: Observation[] = [];

  constructor(map: RadioMap, source: BeaconSource, options: Partial<EngineOptions> = {}) {
    this.map = map;
    this.source = source;
    this.opt = { ...DEFAULT_ENGINE, ...options };
    this.tracker = new Tracker(this.opt.tracker);
    this.offset = this.opt.offset ?? 0;
    this.name = `BLE (${source.name})`;
  }

  get deviceOffset(): number {
    return this.offset;
  }

  async start(onFix: (fix: PositionFix) => void, onError?: (error: Error) => void): Promise<void> {
    await this.source.start((batch) => this.ingest(batch));
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.step(Date.now())
        .then((fix) => fix && onFix(fix))
        .catch((e: unknown) => onError?.(e instanceof Error ? e : new Error(String(e))))
        .finally(() => (this.busy = false));
    }, this.opt.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.source.stop();
    this.tracker.reset();
    this.readings = [];
  }

  ingest(readings: BeaconReading[]): void {
    this.readings.push(...readings);
  }

  /** Compute a fix from the readings of the last window. Public for tests and offline replay. */
  async step(now: number): Promise<PositionFix | null> {
    this.readings = this.readings.filter((r) => now - r.timestamp <= this.opt.windowMs);
    const obs = aggregate(this.map, this.readings, now, this.opt.windowMs);
    this.lastObservations = obs;
    if (obs.length === 0) return null;
    await this.map.ensureTiles(candidateTiles(this.map, obs, this.opt.locate.radius));

    if (this.opt.offset === null && obs.length >= 4) {
      const measured = estimateOffset(this.map, obs, this.opt.locate);
      // Average the first few scans equally, then follow slowly.
      const alpha = Math.max(this.opt.offsetAlpha, 1 / ++this.offsetSamples);
      this.offset += alpha * (measured - this.offset);
    }
    const est = locate(this.map, obs, { ...this.opt.locate, offset: this.offset });
    this.lastEstimate = est;
    if (!est) return null;
    const info = { beacons: est.beacons, offset: Math.round(this.offset * 10) / 10, levelConfidence: Math.round(est.levelConfidence * 100) / 100 };
    if (this.opt.raw) {
      return { method: 'ble', lng: est.lng, lat: est.lat, levelId: est.levelId, accuracy: est.accuracy, timestamp: now, info };
    }
    const t = this.tracker.update(est, now);
    return { method: 'ble', lng: t.lng, lat: t.lat, levelId: t.levelId, accuracy: t.accuracy, timestamp: now, info };
  }
}
