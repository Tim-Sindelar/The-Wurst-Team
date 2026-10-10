/**
 * A field test session: the tester stands at known spots (checkpoints) and the app logs every BLE
 * and GPS fix meanwhile. Sessions are exported as JSON and can be re-evaluated offline with
 * `npm run evaluate -- session.json`, through the same evaluate() the app uses.
 */
import type { PositionFix } from '../positioning/types';
import type { GroundTruth, Sample } from './metrics';

export interface Checkpoint {
  id: number;
  truth: GroundTruth;
  /** Measurement window (ms since epoch). */
  start: number;
  end: number;
  note?: string;
}

export interface Session {
  version: 1;
  startedAt: string;
  userAgent: string;
  /** Free text: phone model, building, conditions. */
  description: string;
  checkpoints: Checkpoint[];
  fixes: PositionFix[];
}

export interface SamplingOptions {
  /** Skip the start of each window while filters converge (ms). */
  warmupMs: number;
  /** One sample per this period per method (ms). */
  periodMs: number;
  /** A fix older than this counts as no fix (ms). */
  staleMs: number;
}

export const DEFAULT_SAMPLING: SamplingOptions = { warmupMs: 3000, periodMs: 1000, staleMs: 3000 };

export function newSession(description = ''): Session {
  return {
    version: 1,
    startedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
    description,
    checkpoints: [],
    fixes: [],
  };
}

/**
 * Turn a session into evaluation samples: every periodMs inside each checkpoint window, each method
 * contributes its latest fix (or null when it had none recently). Sampling on a fixed clock instead
 * of per fix keeps a method that reports 10x more often from weighing 10x more, and counts gaps.
 */
export function sessionSamples(session: Session, methods?: string[], options: Partial<SamplingOptions> = {}): Sample[] {
  const opt = { ...DEFAULT_SAMPLING, ...options };
  const names = methods ?? [...new Set(session.fixes.map((f) => f.method))];
  const byMethod = new Map(names.map((m) => [m, session.fixes.filter((f) => f.method === m).sort((a, b) => a.timestamp - b.timestamp)]));
  const samples: Sample[] = [];
  for (const cp of session.checkpoints) {
    for (let t = cp.start + opt.warmupMs; t <= cp.end; t += opt.periodMs) {
      for (const [method, fixes] of byMethod) {
        let latest: PositionFix | null = null;
        for (const f of fixes) {
          if (f.timestamp > t) break;
          latest = f;
        }
        const fresh = latest && t - latest.timestamp <= opt.staleMs && latest.timestamp >= cp.start ? latest : null;
        samples.push({ method, truth: cp.truth, fix: fresh });
      }
    }
  }
  return samples;
}

export function parseSession(text: string): Session {
  const s = JSON.parse(text) as Session;
  if (s.version !== 1 || !Array.isArray(s.checkpoints) || !Array.isArray(s.fixes)) throw new Error('not a polymaps-ar session file');
  return s;
}
