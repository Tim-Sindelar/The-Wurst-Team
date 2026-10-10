/**
 * Smooths single-scan estimates into a track: a 2D random-walk Kalman filter (walking speed as
 * process noise) with an outlier gate, and hysteresis on the floor so a single noisy scan doesn't
 * flip it.
 */
import { fromLocal, toLocal, type LngLat } from '../geo';
import type { Estimate } from './fingerprint';

export interface TrackerOptions {
  /** Process noise: typical walking speed in m/s. */
  speed: number;
  /** Innovations beyond this many sigmas (and gateMin metres) are outliers. */
  gateSigma: number;
  gateMin: number;
  /** After this many consecutive outliers the filter jumps to the measurement. */
  maxOutliers: number;
  /** Scans the new level must win in a row before switching floor (unless very confident). */
  levelHold: number;
  /**
   * Error the filter cannot average away, in metres: consecutive scans share most of their error
   * (same spot, same body shadowing), so the filtered variance alone is overconfident.
   */
  correlatedError: number;
}

export const DEFAULT_TRACKER: TrackerOptions = { speed: 1.4, gateSigma: 3, gateMin: 12, maxOutliers: 3, levelHold: 2, correlatedError: 2.5 };

export interface TrackState extends LngLat {
  levelIndex: number;
  levelId: string;
  accuracy: number;
  timestamp: number;
}

export class Tracker {
  private readonly opt: TrackerOptions;
  private state: { origin: LngLat; x: number; y: number; p: number; t: number; levelIndex: number; levelId: string } | null = null;
  private outliers = 0;
  private levelCandidate: { levelIndex: number; count: number } | null = null;

  constructor(options: Partial<TrackerOptions> = {}) {
    this.opt = { ...DEFAULT_TRACKER, ...options };
  }

  reset(): void {
    this.state = null;
    this.outliers = 0;
    this.levelCandidate = null;
  }

  get current(): TrackState | null {
    const s = this.state;
    if (!s) return null;
    return { ...fromLocal(s.x, s.y, s.origin), levelIndex: s.levelIndex, levelId: s.levelId, accuracy: Math.hypot(Math.sqrt(s.p), this.opt.correlatedError), timestamp: s.t };
  }

  update(est: Estimate, timestamp: number): TrackState {
    const r = est.accuracy ** 2;
    const s = this.state;
    if (!s) {
      this.state = { origin: { lng: est.lng, lat: est.lat }, x: 0, y: 0, p: r, t: timestamp, levelIndex: est.levelIndex, levelId: est.levelId };
      return this.current!;
    }

    // Floor with hysteresis; a floor change also moves the walker (stairs), so widen the prior.
    if (est.levelIndex !== s.levelIndex) {
      const c = this.levelCandidate;
      this.levelCandidate = c && c.levelIndex === est.levelIndex ? { levelIndex: c.levelIndex, count: c.count + 1 } : { levelIndex: est.levelIndex, count: 1 };
      if (this.levelCandidate.count >= this.opt.levelHold || est.levelConfidence > 0.95) {
        s.levelIndex = est.levelIndex;
        s.levelId = est.levelId;
        s.p += 25;
        this.levelCandidate = null;
      } else {
        // Keep the floor and don't let this scan move us; just let uncertainty grow.
        s.p += this.opt.speed ** 2 * Math.max(0, (timestamp - s.t) / 1000);
        s.t = timestamp;
        return this.current!;
      }
    } else {
      this.levelCandidate = null;
    }

    const dt = Math.max(0, (timestamp - s.t) / 1000);
    const prior = s.p + this.opt.speed ** 2 * dt;
    const z = toLocal(est, s.origin);
    const dx = z.x - s.x, dy = z.y - s.y;
    const innovation = Math.hypot(dx, dy);
    const sigma = Math.sqrt(prior + r);
    if (innovation > Math.max(this.opt.gateMin, this.opt.gateSigma * sigma)) {
      this.outliers++;
      if (this.outliers < this.opt.maxOutliers) {
        s.p = prior;
        s.t = timestamp;
        return this.current!;
      }
      // Persistent disagreement: we were wrong (or teleported). Restart at the measurement.
      this.state = { origin: { lng: est.lng, lat: est.lat }, x: 0, y: 0, p: r, t: timestamp, levelIndex: est.levelIndex, levelId: est.levelId };
      this.outliers = 0;
      return this.current!;
    }
    this.outliers = 0;
    const k = prior / (prior + r);
    s.x += k * dx;
    s.y += k * dy;
    s.p = (1 - k) * prior;
    s.t = timestamp;
    return this.current!;
  }
}
