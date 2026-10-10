/**
 * Accuracy evaluation shared by every positioning method: BLE fixes and GPS fixes go through the
 * exact same code, against the same ground truth, so the numbers are comparable.
 */
import { distance, type LngLat } from '../geo';
import type { PositionFix } from '../positioning/types';

export interface GroundTruth extends LngLat {
  levelId: string | null;
}

/** One expected fix: a moment in time with a known true position, and what a method reported. */
export interface Sample {
  method: string;
  truth: GroundTruth;
  /** Most recent fix not older than the staleness limit, or null if the method had none. */
  fix: PositionFix | null;
}

export interface MethodStats {
  method: string;
  samples: number;
  /** Share of samples with a fix. */
  availability: number;
  /** Horizontal errors (m) of the samples with a fix, ascending. */
  errors: number[];
  mean: number;
  median: number;
  p68: number;
  p90: number;
  p95: number;
  rmse: number;
  max: number;
  /** Share of fixes on the true floor, among fixes that report a floor; null if none do. */
  floorRate: number | null;
  /** Share of fixes reporting a floor at all. */
  floorReported: number;
  /** Share of fixes whose error is within their own reported accuracy (68 % if well calibrated). */
  withinReportedAccuracy: number;
  meanReportedAccuracy: number;
}

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function evaluate(samples: Sample[]): MethodStats[] {
  const byMethod = new Map<string, Sample[]>();
  for (const s of samples) {
    const list = byMethod.get(s.method) ?? [];
    list.push(s);
    byMethod.set(s.method, list);
  }
  return [...byMethod.entries()].map(([method, list]) => {
    const withFix = list.filter((s) => s.fix);
    const errors = withFix.map((s) => distance(s.truth, s.fix!)).sort((a, b) => a - b);
    const floorKnown = withFix.filter((s) => s.fix!.levelId !== null && s.truth.levelId !== null);
    const within = withFix.filter((s) => distance(s.truth, s.fix!) <= s.fix!.accuracy).length;
    const n = errors.length;
    return {
      method,
      samples: list.length,
      availability: list.length ? n / list.length : 0,
      errors,
      mean: n ? errors.reduce((a, b) => a + b, 0) / n : NaN,
      median: percentile(errors, 0.5),
      p68: percentile(errors, 0.68),
      p90: percentile(errors, 0.9),
      p95: percentile(errors, 0.95),
      rmse: n ? Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / n) : NaN,
      max: n ? errors[n - 1] : NaN,
      floorRate: floorKnown.length ? floorKnown.filter((s) => s.fix!.levelId === s.truth.levelId).length / floorKnown.length : null,
      floorReported: n ? floorKnown.length / n : 0,
      withinReportedAccuracy: n ? within / n : NaN,
      meanReportedAccuracy: n ? withFix.reduce((a, s) => a + s.fix!.accuracy, 0) / n : NaN,
    };
  });
}

export function formatStats(stats: MethodStats[]): string {
  const f = (v: number | null, d = 1) => (v === null || Number.isNaN(v) ? '–' : v.toFixed(d));
  const pct = (v: number | null) => (v === null || Number.isNaN(v) ? '–' : `${Math.round(v * 100)} %`);
  const rows = [
    ['method', 'samples', 'avail.', 'median', 'mean', 'p68', 'p90', 'p95', 'rmse', 'max', 'floor ok', 'err<=acc', 'mean acc'],
    ...stats.map((s) => [
      s.method, String(s.samples), pct(s.availability), f(s.median), f(s.mean), f(s.p68), f(s.p90), f(s.p95), f(s.rmse), f(s.max),
      pct(s.floorRate), pct(s.withinReportedAccuracy), f(s.meanReportedAccuracy),
    ]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')).join('\n');
}
